
import { ChatMessageRoleEnum, Memory, MentalProcess, indentNicely, useActions, usePerceptions, useProcessManager, useSoulMemory, useSoulStore, z } from "@opensouls/engine";
import externalDialog from "../cognitiveSteps/externalDialog.js";
import { ToolPossibilities, toolChooser } from "../cognitiveFunctions/toolChooser.js";
import readsAFile from "./readsAFile.js";
import chats from "./chat.js";
import { updateNotes } from "../cognitiveFunctions/notes.js";
import internalMonologue from "../cognitiveSteps/internalMonologue.js";
import spokenDialog from "../cognitiveSteps/spokenDialog.js";
import summarizesConversation from "../cognitiveFunctions/summarizeConversation.js";
import { BIG_MODEL, FAST_MODEL } from "../lib/models.js";

const tools: ToolPossibilities = {
  "cd": {
    description: "Change directory to a directory in the current working directory.",
    params: z.object({
      directory: z.string().describe("The directory to change to")
    })
  },
  "ls": {
    description: "List the files in the current directory.",
  },
  "openInEditor": {
    description: "Opens a file (in the current directory) in a text editor.",
    params: z.object({
      file: z.string().describe("The file to read or edit.")
    })
  },
  "fileATicket": {
    description: "Files a ticket (feature request, bug report, etc) with Philip's creator. This is useful if the code change is too broad or if Philip doesn't feel comfortable actually changing his code.",
    params: z.object({
      subject: z.string().describe("The one line description of the ticket."),
      content: z.string().describe("the content of the ticket, what Philip would want done.")
    })
  },
  "stop": {
    description: "Stops exploring the file system and chat with the Philip's creator (after Philip has a good understanding of the codebase).",
  },
}

interface ListEntry {
  name: string;
  isDirectory: boolean;
}

const exploreFilesystem: MentalProcess = async ({ workingMemory }) => {
  const { speak, dispatch, log } = useActions()
  const { invocationCount } = useProcessManager()
  const { invokingPerception } = usePerceptions()
  const { fetch, set } = useSoulStore()
  // const latestList = useSoulMemory<ListEntry[]>("latestList", [])

  if (invocationCount === 0) {
    log("dispatching ls")
    dispatch({
      action: "ls",
      content: ""
    })
    return workingMemory.withMonologue("Philip lists the files in the current working directory.")
  }

  workingMemory = await summarizesConversation({ workingMemory })

  if (invokingPerception?._metadata?.list) {
    const { list, cwd } = invokingPerception._metadata as unknown as { list: ListEntry[], cwd: string }

    log("got list", list)
    const entries = await Promise.all(list.map(async (entry ) => {
      const res = await fetch(`${cwd}/${entry.name}`)
      if (!res) {
        return null
      }
      return {
        name: entry.name,
        content: res,
        isDirectory: entry.isDirectory
      }
    }))

    const memories = entries.filter((entry): entry is { name: string; content: string, isDirectory: boolean } => Boolean(entry)).map(({ name, content, isDirectory }) => {
      const openingTag = isDirectory ? `<directory name='${name}'>` : `<file name='${name}'>`
      const closingTag = isDirectory ? `</directory>` : `</file>`
      return indentNicely`
        ${openingTag}
          ${content}
        ${closingTag}
      `
    })

    if (memories.length > 0) {
      log("memories of files already explored:", memories)
      workingMemory = workingMemory.withMonologue(indentNicely`
        ## ${workingMemory.soulName} remembers looking at the following files/directories in the current working directory:
        ${memories.join("\n\n")}
      `)

      const [, takeaway] = await internalMonologue(
        workingMemory,
        indentNicely`
          Given what ${workingMemory.soulName} remembers about the files in the directory, what is their 1-4 sentence takeway on the directory itself?
        `,
        {
          model: FAST_MODEL,
        }
      )
      log("setting directory takeaway", takeaway)
      set(cwd, takeaway)
    }

  }

  const [withMonologue, monologue] = await internalMonologue(
    workingMemory,
    indentNicely`
      What does ${workingMemory.soulName} want to do after seeing this list of files?
    `,
    {
      model: BIG_MODEL,
    }
  )

  log("monologue: ", monologue)

  const [withDialog, stream, resp] = await spokenDialog(
    withMonologue,
    `${workingMemory.soulName} thinks out loud about what they are seeing, and what they are feeling.`,
    { model: BIG_MODEL, stream: true }
  );
  speak(stream);

  const [, [toolMemory, toolChoice, args]] = await Promise.all([
    updateNotes(withDialog),
    toolChooser(withDialog, tools)
  ])

  log("Tool choice: ", toolChoice, "Args: ", args)
  if (toolChoice === "openInEditor") {
    return [toolMemory, readsAFile]
  }

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

  if (toolChoice === "stop") {
    return [cleanedMemory, chats, { executeNow: true }]
  }

  return cleanedMemory;
}

export default exploreFilesystem;
