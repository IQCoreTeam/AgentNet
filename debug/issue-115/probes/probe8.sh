echo "=== A. loose object write WITH O_TMPFILE-strip shim ==="
rm -rf /root/hr8; git init -q /root/hr8; cd /root/hr8
LD_PRELOAD=/root/libnotmpfile.so git hash-object -w --stdin <<<'payload-test' >/dev/null 2>&1
echo "objects on disk (expect >=1 if shim fixes it):"; find .git/objects -type f | wc -l
echo "=== B. full clone WITH shim ==="
rm -rf /root/d8
LD_PRELOAD=/root/libnotmpfile.so git clone https://github.com/expressjs/express.git /root/d8 >/tmp/d8.log 2>&1
echo "clone EXIT=$?"; tail -2 /tmp/d8.log
echo "=== DONE ==="
