"""Generate original, synthetic PDF/CSV inputs for local browser acceptance checks."""

from pathlib import Path

from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

root = Path(__file__).resolve().parents[1] / ".scratch/runtime-review/input"
root.mkdir(parents=True, exist_ok=True)
writer = PdfWriter()
font = DictionaryObject(
    {
        NameObject("/Type"): NameObject("/Font"),
        NameObject("/Subtype"): NameObject("/Type1"),
        NameObject("/BaseFont"): NameObject("/Helvetica"),
    }
)
questions = [
    [
        "Reading and Writing - Module 1",
        "1. A garden flourished after regular watering.",
        "Which choice best describes the main idea?",
        "A. Consistent care helped the plants grow.",
        "B. The garden received no attention.",
        "C. The plants grew without water.",
        "D. The garden was removed.",
    ],
    [
        "Reading and Writing - Module 2",
        "1. Choose the grammatically correct sentence.",
        "A. The students is ready.",
        "B. The students are ready.",
        "C. The students was ready.",
        "D. The students be ready.",
    ],
    [
        "Math - Module 1",
        "1. If x + 3 = 5, what is the value of x?",
        "Enter your answer.",
    ],
    [
        "Math - Module 2",
        "1. What is one half written as a decimal?",
        "Enter your answer.",
    ],
]
for lines in questions:
    page = writer.add_blank_page(width=612, height=792)
    page[NameObject("/Resources")] = DictionaryObject(
        {NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})}
    )
    content = (
        "BT /F1 16 Tf 50 725 Td 26 TL "
        + " ".join(
            ("T* " if index else "") + f"({line}) Tj"
            for index, line in enumerate(lines)
        )
        + " ET"
    )
    stream = DecodedStreamObject()
    stream.set_data(content.encode("ascii"))
    page[NameObject("/Contents")] = writer._add_object(stream)
with (root / "synthetic-practice.pdf").open("wb") as output:
    writer.write(output)
(root / "synthetic-answers.csv").write_text(
    "section,module,question_number,type,correct_answer,category\n"
    "Reading and Writing,1,1,multiple choice,A,Main Idea\n"
    "Reading and Writing,2,1,multiple choice,B,Grammar\n"
    "Math,1,1,student-produced response,2,Algebra\n"
    "Math,2,1,student-produced response,0.5|.5,Algebra\n",
    encoding="utf-8",
)
print("Synthetic browser fixtures created inside .scratch/runtime-review/input.")
