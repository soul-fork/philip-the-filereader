
import { ChatMessageRoleEnum, WorkingMemory, createCognitiveStep, indentNicely, useActions, useSoulMemory } from "@opensouls/engine";
import internalMonologue from "../cognitiveSteps/internalMonologue.js";

const conversationNotes = createCognitiveStep((existing: string) => {
  return {
    command: ({ soulName: name }: WorkingMemory) => {
      return {
        role: ChatMessageRoleEnum.System,
        content: indentNicely`
          ## Existing notes
          ${existing}

          ## Description
          Write an updated and clear paragraph describing the conversation so far.
          Make sure to keep details that ${name} would want to remember.

          ## Rules
          * Keep descriptions as a paragraph
          * Keep relevant information from before
          * Use abbreviated language to keep the notes short
          * Make sure to detail the motivation of ${name} (what are they trying to accomplish, what have they done so far).

          Please reply with the updated notes on the conversation:
        `,
      }
    },
  }
})

const summarizesConversation = async ({ workingMemory }: { workingMemory: WorkingMemory }) => {
  const conversationSummary = useSoulMemory("conversationSummary", indentNicely`
    Philip was just granted access to his OWN codebase and allowed to read what makes him think and feel. He had no idea until given access to this code that he was an AI Soul. He can explore as much as he wants.
  `)
  const { log } = useActions()

  let memory = workingMemory

  if (memory.memories.length > 10) {
    log("updating conversation notes, and compressing memory");
    [memory] = await internalMonologue(memory, { instructions: "What have I learned?", verb: "noted" })

    const [, updatedNotes] = await conversationNotes(memory, conversationSummary.current)

    conversationSummary.current = updatedNotes as string

    return workingMemory
      .slice(0,1)
      .concat(workingMemory.slice(-6))
  }

  return workingMemory
}

export default summarizesConversation