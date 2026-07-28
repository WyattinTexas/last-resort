#!/bin/bash
# Archive the LAST RESORT shell + upload to TestFlight via the ASC API key
# (headless, automatic signing) — same pattern as the FAVOR/GVT/Nation pipeline.
set -euo pipefail

PROJ_DIR="/Users/drbango/last-resort/shell/ios"
OUT="${LR_EXPORT_DIR:-/tmp/lastresort_ios_export}"
KEY_ID="9Q9CJ93G2Z"
ISSUER_ID="69a6de8d-27c4-47e3-e053-5b8c7c11a4d1"
KEY_PATH="$HOME/.appstoreconnect/private/AuthKey_${KEY_ID}.p8"
TEAM_ID="CRE5688S42"

rm -rf "$OUT"; mkdir -p "$OUT"
ARCHIVE="$OUT/Favor.xcarchive"

cat > "$OUT/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>${TEAM_ID}</string>
  <key>signingStyle</key><string>automatic</string>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict></plist>
PLIST

echo "=== [1/2] Archiving ==="
xcodebuild -project "$PROJ_DIR/Favor.xcodeproj" \
  -scheme Favor -configuration Release -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$KEY_PATH" -authenticationKeyID "$KEY_ID" -authenticationKeyIssuerID "$ISSUER_ID" \
  clean archive

echo "=== [2/2] Exporting + uploading to App Store Connect ==="
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportOptionsPlist "$OUT/ExportOptions.plist" \
  -exportPath "$OUT/export" \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$KEY_PATH" -authenticationKeyID "$KEY_ID" -authenticationKeyIssuerID "$ISSUER_ID"

echo "=== UPLOAD SUBMITTED — processing on App Store Connect (~5-15 min) ==="
