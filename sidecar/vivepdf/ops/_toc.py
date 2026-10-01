def normalized_toc(toc: list[list]) -> list[list]:
    normalized: list[list] = []
    previous_level = 0
    for level, title, page in toc:
        level = max(1, min(level, previous_level + 1))
        normalized.append([level, title, page])
        previous_level = level
    return normalized
