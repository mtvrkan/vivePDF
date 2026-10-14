import multiprocessing
import sys

from vivepdf._data_home import extend_macos_path
from vivepdf.cli_launcher import CLI_FLAG
from vivepdf.external._landlock import CONTAIN_FLAG

if __name__ == "__main__":
    multiprocessing.freeze_support()
    extend_macos_path()
    if sys.argv[1:2] == [CONTAIN_FLAG]:
        from vivepdf.external._landlock import contain_main

        contain_main(sys.argv[2:])
    elif sys.argv[1:2] == [CLI_FLAG]:
        from vivepdf.cli import main as cli_main

        cli_main(sys.argv[2:])
    else:
        from vivepdf.rpc.server import main

        main()
