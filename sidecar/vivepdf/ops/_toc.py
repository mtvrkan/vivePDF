def normalized_toc(toc: list[list]) -> list[list]:
    normalized: list[list] = []
    previous_level = 0
    for entry in toc:
        level = max(1, min(entry[0], previous_level + 1))
        normalized.append([level, *entry[1:]])
        previous_level = level
    return normalized
