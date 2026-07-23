# Legacy Makefile: prefer README.md, package.json, and functions/package.json
# for the supported command paths. The validated targets in regular use are
# `docs-generate`, `docs-check`, `preset-audit`, `preset-audit-smoke`, `test`, `test-rules`, `test-all`, `verify`, `backup`, `normalize-samples`,
# `install-git-hooks`, `ffunctions`, `seraphony`, `seraphony-stack`, `firestore-rules`,
# `firebase-install-local`, `start-no-reload`, `web-no-reload`, `ios`, `ioss`, `iosss`, `deploy`, `expo-build-web`, `fix`,
# `wasm-build`, `wasm-check`, and `bump-version`.

FIREBASE_PROJECT ?= biosyncare
FIREBASE_LOCAL := ./node_modules/.bin/firebase
FIREBASE_GLOBAL := $(shell command -v firebase 2>/dev/null)
PRESET_AUDIT_DIR := scripts/preset-audit
PRESET_AUDIT_OUTPUT ?= tempo/preset-audit
PRESET_AUDIT_CATALOG ?= referenceDocuments/presets/BSC_Grouped_Presets_ReferenceAligned.json
PRESET_AUDIT_SOUNDSCAPE ?= referenceDocuments/presets/BSC_Soundscape_Compatibility_Map.json
PRESET_AUDIT_BUNDLE_LABEL ?= current-repo-catalog
PRESET_AUDIT_REFERENCE_DOC ?= referenceDocuments/BSC_Preset_Reference.md

# Emscripten cache dir for the WASM worklet build. Must live on a NON-symlinked
# path: the default cache under $TMPDIR (/var/folders/... -> /private/var/... on
# macOS) breaks emscripten's relative-path resolution of system-lib sources like
# crt1.c on first cache generation. See wasm-build / wasm-check targets below.
EM_CACHE ?= $(HOME)/.bsc_emcache

ifeq ($(wildcard $(FIREBASE_LOCAL)),)
  ifneq ($(strip $(FIREBASE_GLOBAL)),)
    FIREBASE := firebase
  else
    FIREBASE :=
  endif
else
  FIREBASE := $(FIREBASE_LOCAL)
endif

define ENSURE_FIREBASE
	@if [ -z "$(FIREBASE)" ]; then \
		echo "Firebase CLI not found."; \
		echo "Run 'make firebase-install-local' or install firebase-tools globally."; \
		exit 1; \
	fi
endef

.PHONY: cleanios cleanios-light prebuild prebuildcc prepareios prepareios-light ios iosp ioss iosss android androidd install-git-hooks bump-version docs-generate docs-check preset-audit preset-audit-smoke start-no-reload start-no-watch web-no-reload web-no-watch wasm-build wasm-check

####
# from Copilot by itself, NOT TESTED:
#  command to expo build web and export web, so to put it in Netlify
 build-web:
	npm run build-web
	cp -r web-build/* ../harmonicare-web
	cd ../harmonicare-web
	git add .
	git commit -m "web build"
	git push origin master
	cd ../HarmoniCare

#  command to expo build android
 build-android:
	npm run build-android

#  command to expo build ios
 build-ios:
	npm run build-ios

#  command use build and export web, android and ios
 build-all:
	 build-web
	 build-android
	 build-ios

##########
# deploy from https://docs.expo.dev/distribution/publishing-websites/ TESTED, WORKS:
 expo-build-web:
	npx expo export -p web

 expo-serve-web:
	npx serve dist --single
# at this point you have the build in the dist folder
# and you can visit it with your browser using a local link, such as:
# http://localhost:3000

 netlify-install:
	npm install netlify-cli -g

# should not be done more than once, to create the Netlify website
 netlify-create:
	netlify sites:create

# deploy the dist folder to netlify staging:
 netlify-deploy:
	netlify deploy --dir dist

# deploy, the production to Netlify, provide the dist folder when asked:
 netlify-deploy2:
	netlify deploy --prod --dir=dist

deploy:
	make expo-build-web
	make netlify-deploy2
# at this point you should have a link to your site, such as:
# https://acca-harmonicare-chromosound.netlify.app/
# and you can visit it with your browser

#####
# local run with expo start, presents web, android and ios options:
 start:
	@pkill -f "expo start" 2>/dev/null || true
	npx expo start -c

# Local Expo run with Metro watch/Fast Refresh reloads disabled. Expo treats
# CI=true as watch disabled, so code edits require restarting this target.
start-no-reload:
	CI=true NODE_OPTIONS='--max-old-space-size=16384' npx expo start

# Web-specific no-reload mode for browser debugging when Fast Refresh is noisy.
web-no-reload:
	CI=true NODE_OPTIONS='--max-old-space-size=16384' npx expo start --web

# fix dependencies, if needed:
fix:
	npx expo install --check

# Bump the user-facing app version string everywhere it must be kept in sync.
# Usage: make bump-version VERSION=1.2.3
#
# Files updated:
#   - package.json                "version"        (read at runtime via pjson.version)
#   - app.json                    expo.version     (Expo / EAS config)
#   - ios/BioSynCare/Info.plist   CFBundleShortVersionString
#   - android/app/build.gradle    versionName
#
# Why all four: this repo commits the native ios/ and android/ folders rather
# than regenerating them via `expo prebuild` on each build, so app.json does
# NOT propagate into the native configs — the plist and gradle files must be
# edited directly to keep iOS/Android in sync with the JS layer.
#
# ============================================================
# versionCode / CFBundleVersion dilemma — NOT TOUCHED HERE
# ============================================================
# `versionCode` (android/app/build.gradle) and `CFBundleVersion`
# (ios/BioSynCare/Info.plist) are *build numbers*, distinct from the
# user-facing version string. App stores require them to strictly increase
# for every uploaded binary, regardless of whether the version string
# changed.
#
#   - EAS production builds: eas.json sets `appVersionSource: "remote"`
#     and `autoIncrement: true`, so EAS bumps the build number on the
#     server for every production build. Local versionCode / CFBundleVersion
#     values are ignored on that path.
#   - Local store-bound builds (e.g. `make iosss`, `make gradlewr` for a
#     release artifact you intend to submit): you MUST bump versionCode
#     and CFBundleVersion by hand before building, or store upload will
#     reject the binary as a duplicate.
#   - OTA / JS-only releases (no new native binary shipped): build numbers
#     do not need to change. Only the version string matters.
#
# This target stays out of that decision on purpose — bump build numbers
# manually when you know which release path applies.
bump-version:
	@if [ -z "$(VERSION)" ]; then \
		echo "Usage: make bump-version VERSION=1.2.3"; exit 1; \
	fi
	@echo "$(VERSION)" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$$' || { \
		echo "VERSION must be MAJOR.MINOR.PATCH (got: $(VERSION))"; exit 1; }
	@perl -i -0777 -pe 's/"version":\s*"[^"]+"/"version": "$(VERSION)"/' package.json
	@perl -i -0777 -pe 's/"version":\s*"[^"]+"/"version": "$(VERSION)"/' app.json
	@perl -i -0777 -pe 's|(<key>CFBundleShortVersionString</key>\s*<string>)[^<]*(</string>)|$${1}$(VERSION)$${2}|' ios/BioSynCare/Info.plist
	@perl -i -pe 's/versionName "[^"]*"/versionName "$(VERSION)"/' android/app/build.gradle
	@echo "Bumped version string to $(VERSION) in package.json, app.json, ios/BioSynCare/Info.plist, android/app/build.gradle."
	@echo "Reminder: versionCode / CFBundleVersion not touched — see Makefile comments above this target."

xcode:
	cd ios && xed .

# run unit tests for Cloud Functions
test:
	cd functions && npm test

test-rules:
	npm run test:rules

test-all:
	npm run test:client -- --runInBand
	$(MAKE) test
	$(MAKE) test-rules

docs-generate:
	npm run docs:generate

docs-check:
	npm run docs:check

preset-audit:
	@mkdir -p "$(PRESET_AUDIT_OUTPUT)"
	PYTHONPATH="$(PRESET_AUDIT_DIR):$${PYTHONPATH:-}" python3 -m bsc_audit "$(PRESET_AUDIT_CATALOG)" --soundscape "$(PRESET_AUDIT_SOUNDSCAPE)" --out "$(PRESET_AUDIT_OUTPUT)/findings.json" --report "$(PRESET_AUDIT_OUTPUT)/audit.md" --algorithm-script "$(PRESET_AUDIT_OUTPUT)/preset_audit_algorithm.py" --bundle-label "$(PRESET_AUDIT_BUNDLE_LABEL)" --reference-doc "$(PRESET_AUDIT_REFERENCE_DOC)"
	@echo "Preset audit outputs: $(PRESET_AUDIT_OUTPUT)/findings.json, $(PRESET_AUDIT_OUTPUT)/audit.md, and $(PRESET_AUDIT_OUTPUT)/preset_audit_algorithm.py"

preset-audit-smoke:
	PYTHONPATH="$(PRESET_AUDIT_DIR):$${PYTHONPATH:-}" python3 "$(PRESET_AUDIT_DIR)/smoke_test.py" "$(PRESET_AUDIT_CATALOG)" "$(PRESET_AUDIT_SOUNDSCAPE)"

verify:
	npm run typecheck
	npm run docs:check
	npm run agent-audit
	npm run lint:strict
	$(MAKE) test-all
	@echo "Verification passed. Documentation/directive sync remains mandatory whenever repo truth changed."

backup:
	npm run backup:firebase -- $(BACKUP_ARGS)

# Normalize all soundscape sample files in ../samplesHC to -18 LUFS using
# ffmpeg's two-pass loudnorm filter (EBU R128), then update the remote URLs in
# components/SampleToggler.js to point at the _normalized variants.
#
# SamplesHC location: the script expects the samples repo to be checked out as
# a sibling of this repo, i.e. ../samplesHC relative to the BioSynCare root.
# Clone it with: git clone https://github.com/RichiNevan/SamplesHC ../samplesHC
#
# What it does:
#   1. Reads every .mp3/.wav in ../samplesHC (skips test_ files and any file
#      already containing _normalized in its name).
#   2. Runs a two-pass loudnorm measurement + encode, producing
#      <name>_normalized.mp3 alongside the original in ../samplesHC.
#   3. Updates the matching GitHub raw URLs in components/SampleToggler.js.
#
# After running:
#   cd ../samplesHC && git add *_normalized.mp3 && git commit -m "add normalized samples" && git push
#   The updated URLs in SampleToggler.js will then resolve on next app build.
#
# Requires: ffmpeg 4+ in PATH (brew install ffmpeg).
# Use --dry-run to preview without writing files: node scripts/normalizeSamples.js --dry-run
normalize-samples:
	node scripts/normalizeSamples.js

# Install repo-local Git hooks. The pre-commit hook unstages CocoaPods-generated
# iOS churn unless the real native input files are staged too.
install-git-hooks:
	@mkdir -p .git/hooks
	cp scripts/git-hooks/pre-commit .git/hooks/pre-commit
	cp scripts/git-hooks/pre-push .git/hooks/pre-push
	chmod +x .git/hooks/pre-commit
	chmod +x .git/hooks/pre-push
	@echo "Installed .git/hooks/pre-commit and refreshed no-op .git/hooks/pre-push"

firebase-install-local:
	npm install --save-dev firebase-tools

ffunctions:
	$(ENSURE_FIREBASE)
	$(FIREBASE) deploy --only functions --project $(FIREBASE_PROJECT)

seraphony:
	$(ENSURE_FIREBASE)
	$(FIREBASE) deploy --only functions:generateSeraphonyPreset --project $(FIREBASE_PROJECT)

seraphony-stack:
	$(ENSURE_FIREBASE)
	$(FIREBASE) deploy --only functions:generateSeraphonyPreset,firestore:rules --project $(FIREBASE_PROJECT)

translate:
	$(ENSURE_FIREBASE)
	$(FIREBASE) deploy --only functions:translatePresetField --project $(FIREBASE_PROJECT)

functions-secret-gemini:
	$(ENSURE_FIREBASE)
	$(FIREBASE) functions:secrets:set GEMINI_API_KEY --project $(FIREBASE_PROJECT)

firestore-rules:
	$(ENSURE_FIREBASE)
	$(FIREBASE) deploy --only firestore:rules --project $(FIREBASE_PROJECT)

owner:
	@echo "Refusing to run a machine-specific chown target. Update this locally if you still need it."

#Checks all header search paths for ios
hsp:
	cd ios && xcodebuild -showBuildSettings | grep HEADER_SEARCH_PATHS

concatwebaudio:
	cd utils && python3 concat_webAudio.py

concatcpp:
	cd utils && python3 concat_nativeAudio.py

concathubs:
	cd utils && python3 concat_hubs.py

concatai:
	cd utils && python3 concat_seraphony.py

# Build the C++ audio worklet to WASM and re-embed it as base64 into
# audio/workletWasm/workletWasmProcessorSource.js. Runs the npm script with a
# non-symlinked EM_CACHE (see the EM_CACHE variable above) so emscripten can
# resolve crt1.c on first system-lib cache generation. Override the cache dir
# with: make wasm-build EM_CACHE=/some/non-symlinked/path
wasm-build:
	@mkdir -p "$(EM_CACHE)"
	EM_CACHE="$(EM_CACHE)" npm run wasm:build

# Recompile the worklet WASM and assert it is byte-identical to the embedded
# base64 (drift check). Same EM_CACHE workaround as wasm-build.
wasm-check:
	@mkdir -p "$(EM_CACHE)"
	EM_CACHE="$(EM_CACHE)" npm run wasm:check

gradlewd:
	cd android && ./gradlew generateCodegenArtifactsFromSchema && ./gradlew clean && rm -rf app/.cxx && ./gradlew assembleDebug && ./gradlew installDebug

gradlewr:
	cd android && ./gradlew generateCodegenArtifactsFromSchema && ./gradlew clean && rm -rf app/.cxx && ./gradlew assembleRelease && ./gradlew installRelease

cleanios:
	cd ios && rm -rf build Pods Podfile.lock && pod deintegrate && pod install

# Lighter counterpart to cleanios: keeps Pods/ and Podfile.lock in place so
# CocoaPods can sync incrementally instead of reinstalling every pod. Use this
# when you only need to drop the Xcode build artifacts.
cleanios-light:
	cd ios && rm -rf build && pod install

cleancache:
	rm -rf node_modules && rm -rf package-lock.json && npm cache clean --force && npm install

prebuild:
	npx expo prebuild

prebuildcc:
	npx expo prebuild --clean

prepareios:
	make cleanios
	npx expo prebuild --platform ios

# Lighter counterpart to prepareios: regenerates ios/ via expo prebuild and
# reconciles Pods incrementally, without the full wipe in cleanios.
prepareios-light:
	make cleanios-light
	npx expo prebuild --platform ios

# Fast incremental local-device rerun.
#
# Use `make ios` after:
#   - JS/TS source changes (bridge, hooks, screens, audio/types.ts)
#   - cpp/ native C++ changes (compiled by Xcode during this step)
#   - Any change Xcode needs to recompile but Metro doesn't auto-pick up
#
# Skip `make ios` entirely if Metro is already running and HMR covers the change
# (pure JS/TS edits while the dev server is live).
ios:
	git rev-parse HEAD > .ios_build
	npx expo run:ios --device

# Middle-tier local-device rebuild: regenerates ios/ via expo prebuild and lets
# CocoaPods sync incrementally, without wiping Pods/ or running pod deintegrate.
#
# Use `make iosp` after:
#   - app.json changes (plugins, bundle ID, entitlements, SDK version)
#   - Podfile / Podspec / Gemfile edits that are additive or minor
#   - New native Expo plugins or pod dependencies added to package.json
#
# Reach for `make ioss` only when incremental builds are genuinely stuck or the
# Pods/ tree looks corrupt — the full wipe is rarely needed for normal config
# changes.
iosp:
	make prepareios-light
	git rev-parse HEAD > .iosp_build
	@echo "iosp build recorded: $$(cat .iosp_build)"
	npx expo run:ios --device

# Slow clean local-device rebuild (runs prepareios: cleanios + expo prebuild).
#
# Use `make ioss` after:
#   - app.json changes (plugins, bundle ID, entitlements, SDK version)
#   - ios/ generated files, Podfile, Podspec, Gemfile
#   - New native Expo plugins or pod dependencies added to package.json
#   - Entitlement or capability changes
#   - When incremental iOS builds go stale or stop reflecting changes
#
# .ioss_build records the commit at which prepareios last ran successfully.
# An agent can diff against it to decide if ioss is needed again.
ioss:
	make prepareios
	git rev-parse HEAD > .ioss_build
	@echo "ioss build recorded: $$(cat .ioss_build)"
	npx expo run:ios --device

# Production build for iOS, with EAS, to be tested on TestFlight.
# .easignore controls the build context. It EXCLUDES ios/ and android/: EAS runs
# prebuild itself when they are absent, so the local copies would only risk
# stale Pods/Gradle state. Note .easignore *replaces* .gitignore for EAS rather
# than supplementing it, so new .gitignore rules must be mirrored into it.
iosss:
#	make prepareios
	eas build --platform ios --local --clear-cache

# Fast incremental local-device rerun, Android counterpart of `make ios`.
# .android_build records the commit at which this last ran, like .ios_build.
android:
	git rev-parse HEAD > .android_build
	npx expo run:android --device

# Alias kept for muscle memory; prefer `make android`.
androidd: android

# .androiddd_build records the commit of the last local EAS Android build.
androiddd:
	git rev-parse HEAD > .androiddd_build
	@echo "androiddd build recorded: $$(cat .androiddd_build)"
	eas build --platform android --local

samsung:
	adb pair 192.168.1.5:38405 558198

builds:
	make androiddd
	make iosss

xcode:
	cd ios && xed .

ota:
	eas update --channel production