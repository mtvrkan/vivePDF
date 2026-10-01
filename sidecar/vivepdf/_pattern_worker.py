import re


def serve(connection) -> None:
    connection.send("ready")
    while True:
        try:
            source, flags, texts, windows = connection.recv()
        except EOFError:
            return
        pattern = re.compile(source, flags)
        connection.send(
            [
                [match.span() for match in pattern.finditer(texts[index], begin, end)]
                for index, begin, end in windows
            ]
        )
