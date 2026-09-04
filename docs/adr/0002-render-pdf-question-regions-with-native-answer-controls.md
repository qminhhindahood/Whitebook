# Render PDF Question Regions with native answer controls

Questions will preserve their source appearance by rendering confirmed Question Regions from the original PDF, while multiple-choice and student-produced responses use native application controls. Reconstructing arbitrary PDF content as semantic HTML would be unreliable for equations, diagrams, tables, and reading order, while displaying whole PDF pages would prevent a focused one-question experience.

## Consequences

Every Test Package requires confirmed Question Regions before publication. The required user inputs are the Source PDF and Answer CSV; transcribed question text, choice text, and alt text are not required. Extraction and crop suggestions may assist authoring, but the original PDF remains the visual source of truth, native controls remain the response source of truth, and the product does not claim that PDF-only question content is fully screen-reader accessible.
