#!/bin/sh
# Packages this extension into a .vsix without needing Node/npm,
# so it can be installed with: code --install-extension eos1d3.build-buttons-<ver>.vsix
set -e

SRC="$(cd "$(dirname "$0")" && pwd)"
OUT="$SRC"
ID="eos1d3.build-buttons"
VERSION="$(grep -m1 '"version"' "$SRC/package.json" | sed 's/.*"version": *"\([^"]*\)".*/\1/')"
VSIX="$OUT/$ID-$VERSION.vsix"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/extension"
cp "$SRC/package.json" "$SRC/extension.js" "$SRC/jsonc.js" "$SRC/README.md" "$SRC/icon.png" "$STAGE/extension/"
if [ -f "$SRC/LICENSE" ]; then
  cp "$SRC/LICENSE" "$STAGE/extension/LICENSE.txt"
fi

cat > "$STAGE/extension.vsixmanifest" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="en-US" Id="build-buttons" Version="$VERSION" Publisher="eos1d3"/>
    <DisplayName>Build Buttons</DisplayName>
    <Description xml:space="preserve">One compact status bar button per project. Click the name to run the default build task, click the arrow to expand all task buttons.</Description>
    <Categories>Other</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="^1.75.0" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="ui,workspace" />
    </Properties>
    <License>extension/LICENSE.txt</License>
    <Icon>extension/icon.png</Icon>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code"/>
  </Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENSE.txt" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/icon.png" Addressable="true" />
  </Assets>
</PackageManifest>
EOF

cat > "$STAGE/[Content_Types].xml" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json"/>
  <Default Extension="vsixmanifest" ContentType="text/xml"/>
  <Default Extension="js" ContentType="application/javascript"/>
  <Default Extension="md" ContentType="text/markdown"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="txt" ContentType="text/plain"/>
</Types>
EOF

(cd "$STAGE" && zip -q -r "$VSIX" extension.vsixmanifest "[Content_Types].xml" extension)
echo "Created: $VSIX"
echo "Install with: code --install-extension \"$VSIX\""
