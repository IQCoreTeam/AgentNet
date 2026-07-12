echo "=== 1. hardlink: does l2s turn ln into a symlink? ==="
cd /tmp; rm -f h1 h2; echo hello > h1; ln h1 h2 2>&1
ls -la h1 h2
echo "--- link count of h1 (2 = real hardlink, 1 = faked) ---"
stat -c 'links=%h' h1 2>/dev/null
echo "=== 2. minimal git add/commit/fsck (loose objects) ==="
rm -rf /tmp/gr; git init -q /tmp/gr; cd /tmp/gr
printf 'c%s\n' 1 2 3 4 5 > f; git add f 2>&1 | tail -1; echo "add=$?"
git -c user.email=a@b -c user.name=a commit -qm x >/dev/null 2>&1; echo "commit=$?"
git fsck --full 2>&1 | tail -2; echo "fsck=$?"
echo "=== 3. repack (index-pack path, no network) ==="
git repack -a -d -f 2>&1 | tail -1; echo "repack=$?"
git fsck --full 2>&1 | tail -2; echo "fsck2=$?"
echo "=== 4. read object back ==="
git cat-file -p HEAD^{tree} 2>&1 | tail -2; echo "cat=$?"
echo "=== DONE ==="
