rm -f /root/objtrace.log
rm -rf /root/or; git init -q /root/or; cd /root/or
echo "=== writing one loose object with link/rename/fsync instrumented ==="
LD_PRELOAD=/root/libobjtrace.so git hash-object -w --stdin <<<'trace-payload-xyz' ; echo "hash-object exit=$?"
echo "=== objtrace.log (what link/rename/fsync actually did) ==="
cat /root/objtrace.log 2>/dev/null || echo "(no log - shim not loaded?)"
echo "=== objects actually on disk ==="
find .git/objects -type f 2>/dev/null; echo "count=$(find .git/objects -type f 2>/dev/null | wc -l)"
echo "=== DONE ==="
