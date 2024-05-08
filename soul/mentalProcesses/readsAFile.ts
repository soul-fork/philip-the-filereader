
import { ChatMessageRoleEnum, MentalProcess, indentNicely, useActions, usePerceptions, useSoulStore, z } from "@opensouls/engine";
import { ToolPossibilities, toolChooser } from "../cognitiveFunctions/toolChooser.js";
import instruction from "../cognitiveSteps/instruction.js";
import exploreFilesystem from "./exploreFilesystem.js";
import { updateNotes } from "../cognitiveFunctions/notes.js";
import internalMonologue from "../cognitiveSteps/internalMonologue.js";
import spokenDialog from "../cognitiveSteps/spokenDialog.js";
import editsAFile from "./editsAFile.js";
import summarizesConversation from "../cognitiveFunctions/summarizeConversation.js";
import { BIG_MODEL, FAST_MODEL } from "../lib/models.js";

const tools: ToolPossibilities = {
  "edit": {
    description: indentNicely`
      Edit a section of the open file. Philip loves this tool, it's fun.

      Philip provides the start and end lines to the edit, and any commentary on why he wants to edit.
    `,
    params: z.object({
      start: z.number().describe("starting line number."),
      end: z.number().describe("ending line number."),
      commentary: z.string().optional().describe("Why does philip want to make this edit?")
    })
  },
  "pageUp": {
    description: "Page up in the current file.",
  },
  "pageDown": {
    description: "Page down in the current file.",
  },
  "exit": {
    description: "Exit reading the current file",
  },
  "fileATicket": {
    description: "Files a ticket (feature request, bug report, etc) with Philip's creator. This is useful if the code change is to broad or if Philip doesn't feel comfortable actually changing his code.",
    params: z.object({
      subject: z.string().describe("The one line description of the ticket."),
      content: z.string().describe("the content of the ticket, what Philip would want done.")
    })
  }
}

const readsAFile: MentalProcess = async ({ workingMemory }) => {
  const { speak, log, dispatch  } = useActions()
  const { invokingPerception } = usePerceptions()
  const { set } = useSoulStore()

  const { cwd, fileName } = invokingPerception!._metadata! as { cwd: string, fileName: string }

  const screen = invokingPerception?._metadata?.screen || ""

  if (invokingPerception?._metadata?.missingFile) {
    // if the file was missing then we shouldn't be in this mentalProcess, and instead should go up to the explore
    return [workingMemory, exploreFilesystem, { executeNow: true }]
  }

  if (invokingPerception?.action === "readFile") {
    // this is the whole file, so should only come through as a summary to the soul.
    // slice off the last memory
    workingMemory = workingMemory.slice(0, -1)
    // summarize
    const { largeChunk: content } = invokingPerception._metadata! as { cwd: string, fileName: string, largeChunk: string }

    log(`read file ${fileName} in ${cwd}`)

    const [, summary] = await instruction(
      workingMemory,
      indentNicely`
        ${workingMemory.soulName} just opened the file.

        ## File '${cwd}/${fileName}' (max first 400 lines)
        ${content}

        Please return a 1-3 sentence version of what ${workingMemory.soulName} would notice first about the file when skimming it.
      `
    )
    workingMemory = workingMemory.withMonologue(indentNicely`
      ${workingMemory.soulName} just opened the file File '${cwd}/${fileName}' in their editor.
      
      Here's what they noticed first about the file:
      ${summary}
    `)
  }

  if (["edited", "failed to edit"].includes(invokingPerception?.action || "")) {
    log("returning to readsAFile from an edit, summarizing")
    if (invokingPerception?.action === "failed to edit") {
      let fixIt: string;
      [workingMemory, fixIt] = await instruction(
        workingMemory,
        indentNicely`
          Please write a 1-3 sentence description of what Philip would do to get around this error. Sometimes Philip would prefer to just file a ticket, sometimes he'd like to make a smaller change, or maybe just fix what he wrote.
        `,
        { model: BIG_MODEL }
      )

      log("potential fix: ", fixIt)
    }

    workingMemory = await summarizesConversation({ workingMemory })
  }

  if (invokingPerception?._metadata?.screen) {
    workingMemory = workingMemory.withMonologue(indentNicely`
      ${workingMemory.soulName} has '${cwd}/${fileName}' open in his editor.
      
      ## Editor Screen
      ${screen}
    `)
  }

  const [withMonologue, monologue] = await internalMonologue(
    workingMemory,
    `What does ${workingMemory.soulName} want to do?`,
    {
      model: BIG_MODEL,
    }
  )

  log("monologue: ", monologue)

  const [withDialog, stream, resp] = await spokenDialog(
    withMonologue,
    `${workingMemory.soulName} thinks out loud (under their breath) about what they are reading and how they feel about it`,
    { stream: true, model: BIG_MODEL }
  );
  speak(stream);

  const [, [, toolChoice, args]] = await Promise.all([
    updateNotes(withDialog),
    toolChooser(withDialog, tools)
  ])
  
  log("Tool choice: ", toolChoice, "Args: ", args)

  const cleanedMemory = workingMemory.concat([
    {
      role: ChatMessageRoleEnum.Assistant,
      content: indentNicely`
        Philip said: ${await resp}
      `
    },
    {
      role: ChatMessageRoleEnum.Assistant,
      content: indentNicely`
        After looking at the list of files and thinking
        > ${monologue}
        ${workingMemory.soulName} decided to call the tool: ${toolChoice} with the argument ${JSON.stringify(args)}.
      `
    }
  ])

  if (toolChoice === "edit") {
    const { start, end, commentary } = args
    const { cwd, fileName } = invokingPerception!._metadata! as { cwd: string, fileName: string }

    log("edits a file", cwd, fileName, start, end, commentary)
    
    return [cleanedMemory, editsAFile, { params: { start, end, commentary, screen }, executeNow: true }]
  }

  if (toolChoice === "exit") {
    // let's create a takeaway from this file
    const [, takeaway] = await instruction(
      cleanedMemory,
      indentNicely`
        ${workingMemory.soulName} just decided to stop reading the file: ${cwd}/${fileName}.

        Write a 2-4 sentence takewaway on what ${workingMemory.soulName} learned from the file, related to their goal. Espcially keep details they would want to remember when scanning the file system again.
      `,
      {
        model: FAST_MODEL,
      }
    )

    log("takeaway: ", takeaway)
    set(`${cwd}/${fileName}`, takeaway)

    return [cleanedMemory, exploreFilesystem, { executeNow: true }]
  }

  return cleanedMemory;
}

export default readsAFile;
