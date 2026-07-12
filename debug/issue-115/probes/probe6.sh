echo "=== A. plain rename (mv) ==="
cd /tmp; rm -f s d; echo hello > s; mv s d 2>&1; echo "mv=$?"; cat d 2>&1
echo "=== B. rename into 2-char subdir (git objects layout) ==="
rm -rf /tmp/od; mkdir -p /tmp/od/ab; echo objdata > /tmp/od/tmp_o; mv /tmp/od/tmp_o /tmp/od/ab/cdef 2>&1; echo "mv2=$?"; cat /tmp/od/ab/cdef 2>&1
echo "=== C. git hash-object -w : write ONE loose object, verify it survives ==="
rm -rf /tmp/hr; git init -q /tmp/hr; cd /tmp/hr
echo "payload-content-xyz" > f
H=$(git hash-object -w f 2>/dev/null); echo "hash=$H"
echo "object file on disk:"; find .git/objects -type f 2>&1
echo "read back:"; git cat-file -p "$H" 2>&1; echo "cat=$?"
echo "=== D. write 50 objects, count how many actually survive on disk ==="
ok=0; for i in $(seq 1 50); do printf 'obj-%d-payload\n' $i | git hash-object -w --stdin >/dev/null 2>&1 && ok=$((ok+1)); done
echo "hash-object reported ok=$ok / 50"
echo "actual files in .git/objects:"; find .git/objects -type f | wc -l
git fsck --full 2>&1 | grep -ciE "missing|bad|corrupt"; echo "(count of fsck error lines)"
echo "=== DONE ==="
