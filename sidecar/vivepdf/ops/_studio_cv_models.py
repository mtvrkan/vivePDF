from typing import Literal

from pydantic import Field

from vivepdf.rpc.protocol import RpcModel

ContactKind = Literal["email", "phone", "website", "location", "linkedin", "github", "other"]
SectionKey = Literal[
    "personal",
    "contact",
    "summary",
    "experience",
    "education",
    "skills",
    "languages",
    "certificates",
    "projects",
    "references",
    "interests",
    "custom",
]


class StudioCvImportParams(RpcModel):
    path: str = Field(min_length=1, max_length=4096)
    password: str | None = Field(default=None, max_length=1024)


class CvContact(RpcModel):
    kind: ContactKind
    value: str


class CvExperience(RpcModel):
    role: str = ""
    organisation: str = ""
    location: str = ""
    start: str = ""
    end: str = ""
    current: bool = False
    details: str = ""


class CvEducation(RpcModel):
    degree: str = ""
    school: str = ""
    location: str = ""
    start: str = ""
    end: str = ""
    details: str = ""


class CvLevelled(RpcModel):
    name: str
    level: int = Field(default=0, ge=0, le=5)


class CvCertificate(RpcModel):
    name: str = ""
    issuer: str = ""
    date: str = ""


class CvProject(RpcModel):
    name: str = ""
    link: str = ""
    details: str = ""


class CvReference(RpcModel):
    name: str = ""
    role: str = ""
    contact: str = ""


class CvCustom(RpcModel):
    heading: str
    body: str


class CvProfile(RpcModel):
    name: str = ""
    headline: str = ""
    contacts: list[CvContact] = Field(default_factory=list)
    summary: str = ""
    experience: list[CvExperience] = Field(default_factory=list)
    education: list[CvEducation] = Field(default_factory=list)
    skills: list[CvLevelled] = Field(default_factory=list)
    languages: list[CvLevelled] = Field(default_factory=list)
    certificates: list[CvCertificate] = Field(default_factory=list)
    projects: list[CvProject] = Field(default_factory=list)
    references: list[CvReference] = Field(default_factory=list)
    interests: str = ""
    custom: list[CvCustom] = Field(default_factory=list)


class CvSection(RpcModel):
    key: SectionKey
    count: int
    confidence: float


class StudioCvImportResult(RpcModel):
    profile: CvProfile
    sections: list[CvSection]
    source: Literal["linkedin", "generic"]
    pages: int
