#!/usr/bin/env python3
# issue #112 — single-process `git clone` for the proot guest (see git-clone-shim.sh).
# dulwich runs the entire clone in one Python process via plain file I/O, avoiding git's
# multi-process pack fetch and cross-subprocess file handoff, both of which proot corrupts
# under Android's targetSdk-35 untrusted_app domain.
import sys
from dulwich import porcelain


# Flags whose VALUE arrives as the next argv element. They must be consumed even when
# ignored, or the value would be mistaken for the URL (`git clone -b dev <url>` would
# try to clone "dev"). --depth and -b/--branch are honored; the rest are known
# value-taking clone flags that dulwich has no equivalent for — consumed and dropped.
VALUE_FLAGS = {
    "--depth", "-b", "--branch", "-o", "--origin", "-c", "--config",
    "--reference", "--reference-if-able", "--separate-git-dir", "--template",
    "-u", "--upload-pack", "--shallow-since", "--shallow-exclude", "-j", "--jobs",
    "--filter", "--bundle-uri", "--server-option",
}


def main():
    args = [a for a in sys.argv[1:] if a != "clone"]
    depth = None
    branch = None
    positional = []
    it = iter(args)
    for a in it:
        if a in VALUE_FLAGS:
            try:
                v = next(it)
            except StopIteration:
                sys.stderr.write("git clone: flag %s requires a value\n" % a)
                sys.exit(2)
            if a == "--depth":
                depth = int(v)
            elif a in ("-b", "--branch"):
                branch = v
        elif a.startswith("--depth="):
            depth = int(a.split("=", 1)[1])
        elif a.startswith("--branch="):
            branch = a.split("=", 1)[1]
        elif a.startswith("-"):
            continue  # valueless flags: -q/--progress/--single-branch/etc.
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
        porcelain.clone(
            url, dst, depth=depth,
            # dulwich 0.20.31 builds refs as bytes (refs/remotes/<origin>/ + branch)
            branch=branch.encode("utf-8") if branch is not None else None,
            errstream=sys.stderr.buffer,
        )
    except Exception as e:  # noqa: BLE001 — surface any dulwich failure like git would
        sys.stderr.write("fatal: clone failed: %s\n" % e)
        sys.exit(1)


if __name__ == "__main__":
    main()
