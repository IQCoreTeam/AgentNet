echo "=== A: shallow depth-1 (tiny pack, few objects) ==="
rm -rf /root/d4a; git clone --depth 1 https://github.com/octocat/Hello-World.git /root/d4a >/tmp/4a 2>&1; echo "A EXIT=$?"; tail -1 /tmp/4a
echo "=== B: force unpack-objects, NOT index-pack ==="
rm -rf /root/d4b; git -c fetch.unpackLimit=999999999 -c transfer.unpackLimit=999999999 clone https://github.com/octocat/Hello-World.git /root/d4b >/tmp/4b 2>&1; echo "B EXIT=$?"; tail -1 /tmp/4b
echo "=== C: LOCAL clone (no network at all, pure index-pack path) ==="
rm -rf /root/seed /root/d4c
git init -q /root/seed && ( cd /root/seed && for i in 1 2 3 4 5; do echo x$i > f$i; done && git -c user.email=a@b -c user.name=a add -A && git -c user.email=a@b -c user.name=a commit -qm seed ) && git clone --no-local /root/seed /root/d4c >/tmp/4c 2>&1; echo "C EXIT=$?"; tail -1 /tmp/4c
echo "=== DONE ==="
