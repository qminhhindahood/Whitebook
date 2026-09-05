"""Validated question content, independent of answer keys and learner state."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class PresentationModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PresentationRegion(PresentationModel):
    pageNumber: int = Field(ge=1, strict=True)
    x: float = Field(ge=0, le=1, allow_inf_nan=False)
    y: float = Field(ge=0, le=1, allow_inf_nan=False)
    width: float = Field(gt=0, le=1, allow_inf_nan=False)
    height: float = Field(gt=0, le=1, allow_inf_nan=False)
    confirmed: Literal[True]

    @model_validator(mode="after")
    def within_page(self):
        if self.x + self.width > 1 or self.y + self.height > 1:
            raise ValueError("Question Regions must stay within the page.")
        return self


class TextBlock(PresentationModel):
    kind: Literal["text"]
    text: str = Field(min_length=1, max_length=50000)

    @model_validator(mode="after")
    def nonempty(self):
        if not self.text.strip():
            raise ValueError("Question text must not be blank.")
        return self


class RegionBlock(PresentationModel):
    kind: Literal["region"]
    region: PresentationRegion
    alt: str | None = Field(default=None, max_length=5000)


ContentBlock = Annotated[TextBlock | RegionBlock, Field(discriminator="kind")]


class Choice(PresentationModel):
    id: Literal["A", "B", "C", "D"]
    content: list[ContentBlock] = Field(min_length=1, max_length=100)


class QuestionPresentation(PresentationModel):
    version: Literal[1]
    stimulus: list[ContentBlock] = Field(max_length=100)
    stem: list[ContentBlock] = Field(min_length=1, max_length=100)
    choices: list[Choice] = Field(default_factory=list, max_length=4)

    @model_validator(mode="after")
    def distinct_choices(self):
        if self.choices:
            if {choice.id for choice in self.choices} != set("ABCD"):
                raise ValueError("Supply one answer for each of A, B, C, and D.")
            self.choices.sort(key=lambda choice: choice.id)
        return self

    def regions(self) -> list[dict[str, object]]:
        blocks = (
            self.stimulus
            + self.stem
            + [block for choice in self.choices for block in choice.content]
        )
        return [
            block.region.model_dump()
            for block in blocks
            if isinstance(block, RegionBlock)
        ]
