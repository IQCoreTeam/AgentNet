#!/usr/bin/env python3
# issue #112 — single-process `git clone` for the proot guest (see git-clone-shim.sh).
# dulwich runs the entire clone in one Python process via plain file I/O, avoiding git's
# multi-process pack fetch and cross-subprocess file handoff, both of which proot corrupts
# under Android's targetSdk-35 untrusted_app domain.
import sys
from dulwich import porcelain


def main():
    args = [a for a in sys.argv[1:] if a != "clone"]
    depth = None
    positional = []
    it = iter(args)
    for a in it:
        if a == "--depth":
            depth = int(next(it))
        elif a.startswith("--depth="):
            depth = int(a.split("=", 1)[1])
        elif a.startswith("-"):
            continue  # ignore -q/--progress/--single-branch/etc.
        else:
            positional.append(a)
    if not positional:
        sys.stderr.write("git clone: missing repository URL\n")
        sys.exit(2)
    url = positional[0]
    if len(positional) > 1:
        dst = positional[1]
    else:
        tail = url.rstrip("/").split("/")[-1]
        dst = tail[:-4] if tail.endswith(".git") else tail
    sys.stderr.write("Cloning into '%s'...\n" % dst)
    try:
        porcelain.clone(url, dst, depth=depth, errstream=sys.stderr.buffer)
    except Exception as e:  # noqa: BLE001 — surface any dulwich failure like git would
        sys.stderr.write("fatal: clone failed: %s\n" % e)
        sys.exit(1)


if __name__ == "__main__":
    main()
