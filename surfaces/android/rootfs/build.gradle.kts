// Play Asset Delivery pack for the heavy Ubuntu rootfs tar.
//
// Why this module exists: base/assets/rootfs-<abi>.tar is ~1.2GB (compresses to ~500MB),
// which pushed the base module PAST Play's 500MB per-module compressed-download cap, so Play
// rejected the AAB. Moving the tar into its own asset pack takes it out of the base module.
//
// deliveryType = install-time: the pack is delivered together WITH the app at install (one
// seamless install, no runtime download, no self-hosting), and — unlike on-demand/fast-follow
// packs — its assets stay reachable through the ordinary AssetManager. So Installer.kt keeps
// calling ctx.assets.open("rootfs-<abi>.tar") and nothing in the extraction path changes.
//
// Size math: per-pack limit is 1.5GB and the cumulative base+install-time limit is 4GB; our
// ~500MB compressed tar fits with wide margin. (APK builds — the sideload debug APK and
// bundletool universal APK — fuse install-time packs back into the single APK, so sideload
// still ships the rootfs and keeps working.)
plugins {
    id("com.android.asset-pack")
}

assetPack {
    packName.set("rootfs")
    dynamicDelivery {
        deliveryType.set("install-time")
    }
}
