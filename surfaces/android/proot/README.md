# AgentNet PRoot build

AgentNet builds PRoot from source instead of shipping the unmodified Termux
package. The source inputs are pinned so the Android binary and its matching
loaders can be reproduced:

- `termux/termux-packages` commit
  `105685dac8697e3b6c2ceb57be24d624afbfa2a3`
- Termux PRoot recipe version `5.1.107.84`
- upstream `termux/proot` tag `v5.1.107.84`
- Termux package-builder image digest
  `sha256:fa23eb4238ef8eda877cd991a06152ce76e9f274d1cae0d42f28fee3e5cd6016`
- [`patches/0001-copy-on-link.patch`](patches/0001-copy-on-link.patch)

The `android-assets` workflow copies the patch into Termux's `packages/proot`
recipe and invokes the official package builder with `-f -I proot`. This keeps
the Termux build's Android/bionic target, `process_vm` accelerator detection,
`libtalloc` and `libandroid-shmem` linkage, and unbundled loader output.

The patch adds the opt-in `--copy-on-link` extension. PRoot still attempts the
real `link(2)` or `linkat(2)` first. If and only if the Android kernel returns
`EACCES`, the extension copies a regular source file to a newly created
destination (`O_EXCL`) and reports success after all bytes and mode bits are
written. Failed copies are removed and the original `EACCES` is preserved.
Other errors, special files, symlink sources, and `AT_EMPTY_PATH` keep their
normal failure behavior.

This is intentionally snapshot semantics, not inode-sharing semantics. It is
enabled only for AgentNet's `untrusted_app` guest, where SELinux rejects every
hardlink and package/tool callers need a data-preserving fallback.

PRoot and this patch are distributed under GPL-2.0-or-later, matching the
upstream source headers and Termux package metadata.
