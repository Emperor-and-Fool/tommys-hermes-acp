#!/bin/bash
# Build hermes-desktopgui_<version>_amd64.deb
#
# A .deb is the right shape for this app on Debian/Ubuntu: Qt and Chromium stay in the
# distro's own packages, so this archive is a few tens of KB instead of the ~550 MB
# PyInstaller bundle in dist/ (which exists for Windows, where nothing is shared).
#
#   ./packaging/build-deb.sh [version]
set -euo pipefail

project_root="$(cd "$(dirname "$0")/.." && pwd)"
version="${1:-2.1.1}"
architecture="amd64"
package_name="hermes-desktopgui"
output_dir="${project_root}/dist"
package_root="$(mktemp -d -t hdg-deb-XXXXXX)"

cleanup() {
    case "${package_root}" in
        /tmp/hdg-deb-*) rm -rf "${package_root}" ;;
    esac
}
trap cleanup EXIT

export SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-$(date -u +%s)}"

install -d \
    "${package_root}/DEBIAN" \
    "${package_root}/usr/bin" \
    "${package_root}/usr/lib/${package_name}/icons" \
    "${package_root}/usr/share/applications" \
    "${package_root}/usr/share/icons/hicolor/scalable/apps" \
    "${package_root}/usr/share/doc/${package_name}" \
    "${output_dir}"

install -m 0644 "${project_root}/hermes_desktop_gui.py" \
    "${package_root}/usr/lib/${package_name}/hermes_desktop_gui.py"
install -m 0644 "${project_root}/installer_gui.py" \
    "${package_root}/usr/lib/${package_name}/installer_gui.py"
install -m 0644 "${project_root}/icons/hermes-nousresearch-sec.svg" \
    "${package_root}/usr/lib/${package_name}/icons/hermes-nousresearch-sec.svg"

# Launcher. The app resolves its icons next to itself, so it runs from /usr/lib unchanged.
cat >"${package_root}/usr/bin/${package_name}" <<'LAUNCHER'
#!/bin/sh
exec /usr/bin/python3 /usr/lib/hermes-desktopgui/hermes_desktop_gui.py "$@"
LAUNCHER
chmod 0755 "${package_root}/usr/bin/${package_name}"

install -m 0644 "${project_root}/packaging/${package_name}.desktop" \
    "${package_root}/usr/share/applications/${package_name}.desktop"
install -m 0644 "${project_root}/icons/hermes-nousresearch-sec.svg" \
    "${package_root}/usr/share/icons/hicolor/scalable/apps/${package_name}.svg"
install -m 0644 "${project_root}/README.md" "${package_root}/usr/share/doc/${package_name}/README.md"
install -m 0644 "${project_root}/packaging/copyright" "${package_root}/usr/share/doc/${package_name}/copyright"

installed_kb="$(du -sk --exclude=DEBIAN "${package_root}" | cut -f1)"

cat >"${package_root}/DEBIAN/control" <<EOF
Package: ${package_name}
Version: ${version}
Section: kde
Priority: optional
Architecture: ${architecture}
Maintainer: Emperor & Fool <thomas.kai.tchong@emperorconsultancy.nl>
Installed-Size: ${installed_kb}
Depends: python3 (>= 3.10), python3-pyqt6, python3-pyqt6.qtwebengine
Recommends: hermes-dashboard
Homepage: https://staging.barchon.emperorandfool.nl
Description: Tray status and window for the local Hermes dashboard
 A tray icon that shows whether the Hermes dashboard answers on
 127.0.0.1:9119 — brand orange when it does, grey when it does not — and a
 QWebEngineView window on the dashboard itself.
 .
 Qt and the Chromium web view come from the distribution (python3-pyqt6,
 python3-pyqt6.qtwebengine); nothing is bundled.
EOF

chmod 0755 "${package_root}"

dpkg-deb --root-owner-group -Zxz --build "${package_root}" \
    "${output_dir}/${package_name}_${version}_${architecture}.deb" >/dev/null

echo "built ${output_dir}/${package_name}_${version}_${architecture}.deb"
du -h "${output_dir}/${package_name}_${version}_${architecture}.deb" | cut -f1 | sed 's/^/size: /'
