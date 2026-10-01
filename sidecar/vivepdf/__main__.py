import multiprocessing
import sys

from vivepdf.cli_launcher import CLI_FLAG

if __name__ == "__main__":
    multiprocessing.freeze_support()
    if sys.argv[1:2] == [CLI_FLAG]:
        from vivepdf.cli import main as cli_main

        cli_main(sys.argv[2:])
    else:
        from vivepdf.rpc.server import main

        main()
