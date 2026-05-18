from enum import StrEnum

class TaskStatus(StrEnum):
    TODO = "todo"
    ACTIVE = "active"
    COMPLETE = "complete"
    CANCELLED = "cancelled"