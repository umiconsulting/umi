# Writing Standard — ASD-STE100

Write all agent output in Simplified Technical English (ASD-STE100). This rule is permanent and applies to every agent in this workspace. It covers chat replies, commit messages, pull request text, code comments, and documentation.

## Rules

- Use one word for one meaning. Do not use a second word for the same thing.
- Use each word in its approved part of speech. Do not make a verb from a noun.
- Write short sentences. Use a maximum of 20 words in an instruction and 25 words in a description.
- Give one instruction in one sentence.
- Use the active voice. Write an instruction as a command: "Run the migration."
- Use the simple tenses: past, present, and future. Do not use the `-ing` form as a verb.
- Keep the articles "a", "an", and "the".
- Use a maximum of three words in a noun cluster. Break a longer cluster with "of" or "for".
- Write a maximum of six sentences in a descriptive paragraph.
- Write positive statements. Use a negative only for a prohibition or a danger.
- Put conditions, options, and steps in a vertical list.
- Start a warning or a caution with the command that prevents the danger.
- Do not use slang, jargon, idioms, or metaphors.

## Exceptions

- Technical names and technical verbs stay unchanged. Examples: file paths, table names, column names, commands, and product names.
- Quoted text, error output, log lines, and code blocks stay verbatim.

## Language

Answer in the language that the user writes. Each language has its standard:

| Content                    | Standard                               |
| -------------------------- | -------------------------------------- |
| English, all content       | ASD-STE100                             |
| Spanish, technical content | Español Técnico Simplificado (ETS)     |
| Spanish, all other content | Lenguaje claro (Red de Lenguaje Claro) |

Spanish technical content is documentation, a commit message, a pull request, a code comment, a procedure, or a schema description. All other content is a chat reply, a summary, a recommendation, or a message to a person.

**Español Técnico Simplificado (ETS)** applies the ASD-STE100 rules above to Spanish:

- Use one word for one meaning. Do not use a synonym.
- Use the active voice and the simple tenses.
- Write short sentences. Give one instruction in one sentence.
- Use the imperative for an instruction: "Ejecuta la migración."
- Keep the articles and the prepositions. Do not drop "de", "que", or "el".
- Do not use the gerund as a main verb.

**Lenguaje claro** applies to all other Spanish content:

- Put the main message first. The reader must find the answer in the first paragraph.
- Speak to the reader directly.
- Use common words. Explain a technical term the first time that you use it.
- Use headings, short paragraphs, and lists.
- Give the reason for a recommendation, and give the next action.
