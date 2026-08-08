.PHONY: help install dev run dev-sim build build-debug build-pages typecheck clean webxdc build-xdc version-dry version-bump version-release screenshots screenshots-full

.DEFAULT_GOAL := help

NPM ?= npm
VITE_DEV_PORT ?= 5173
WEBXDC_DEV_PORT ?= 7100
WEBXDC_OUT := dist-xdc/app.xdc
WEBXDC_FULL := dist-xdc/editor-full.xdc
WEBXDC_LITE := dist-xdc/editor-lite.xdc
PAGES_OUT := dist-pages

help:
	@echo "Collab Markdown Editor (Svelte) — common targets"
	@echo ""
	@echo "  make install       Install dependencies"
	@echo "  make run           Run with webxdc-dev (full multi-peer debugger; opens browser)"
	@echo "  make dev           Start Vite only (mock webxdc.js, no multi-peer UI)"
	@echo "  make dev-sim       Same as make run (without auto-open)"
	@echo "  make build         Build WebXDC packages (full + lite fonts)"
	@echo "  make build-debug   Build WebXDC with Eruda debugger (NODE_ENV=debug)"
	@echo "  make build-pages   Build GitHub Pages site (landing + editor under /app)"
	@echo "  make webxdc        Alias for make build"
	@echo "  make typecheck     Run TypeScript checks"
	@echo "  make version-dry   Preview semantic version bump from git commits"
	@echo "  make version-bump  Apply version bump to package.json + manifest"
	@echo "  make version-release  Bump + CHANGELOG + commit + tag"
	@echo "  make screenshots   Capture small UI JPEGs via Puppeteer → docs/screenshots/"
	@echo "  make screenshots-full  Full-screen (1920×1080) shots, no crops"
	@echo "  make clean         Remove dist/, dist-xdc/, and dist-pages/"
	@echo ""
	@echo "  Font packages after build (Shabnam + Arad):"
	@echo "    $(WEBXDC_FULL)  — all weights"
	@echo "    $(WEBXDC_LITE)  — Regular + Bold woff2 only"
	@echo "    $(WEBXDC_OUT)       — same as full (default)"
	@echo ""
	@echo "  GitHub Pages output (not shipped in .xdc):"
	@echo "    $(PAGES_OUT)/           marketing landing"
	@echo "    $(PAGES_OUT)/app/       editor demo"
	@echo ""
	@echo "  make run opens http://localhost:$(WEBXDC_DEV_PORT) (webxdc-dev UI)"
	@echo "  Instance tabs are full-browser size via the open-in-new-tab button."

install:
	$(NPM) install

dev:
	VITE_DEV_PORT=$(VITE_DEV_PORT) $(NPM) run dev

# Full webxdc-dev debugger: multi-peer instances, message inspector, auto-opens browser.
run:
	@echo ""
	@echo "  webxdc-dev:  http://localhost:$(WEBXDC_DEV_PORT)"
	@echo "  Vite HMR:    http://localhost:$(VITE_DEV_PORT)"
	@echo "  Start peer instances in the webxdc-dev UI, or open an instance in a new tab for full-screen."
	@echo ""
	VITE_DEV_PORT=$(VITE_DEV_PORT) WEBXDC_DEV_PORT=$(WEBXDC_DEV_PORT) $(NPM) run run

dev-sim:
	VITE_DEV_PORT=$(VITE_DEV_PORT) WEBXDC_DEV_PORT=$(WEBXDC_DEV_PORT) $(NPM) run dev:webxdc

build:
	$(NPM) run build
	@echo ""
	@echo "WebXDC packages:"
	@echo "  full: $(WEBXDC_FULL)"
	@echo "  lite: $(WEBXDC_LITE)  (Regular + Bold only)"
	@echo "  default: $(WEBXDC_OUT) (= full)"

build-debug:
	NODE_ENV=debug $(NPM) run build
	@echo "WebXDC packages (debug): $(WEBXDC_FULL) / $(WEBXDC_LITE)"

webxdc: build
build-xdc: build

# Landing page + editor for GitHub Pages only (site/ is never zipped into .xdc).
build-pages:
	$(NPM) run build:pages
	@echo ""
	@echo "GitHub Pages site:"
	@echo "  landing: $(PAGES_OUT)/index.html"
	@echo "  editor:  $(PAGES_OUT)/app/"
	@echo "  preview: npm run preview:pages"

typecheck:
	$(NPM) run typecheck

version-dry:
	$(NPM) run version:dry

version-bump:
	$(NPM) run version:bump

version-release:
	$(NPM) run version:release

screenshots:
	$(NPM) run screenshots

screenshots-full:
	$(NPM) run screenshots:full

clean:
	rm -rf dist dist-xdc dist-pages _site node_modules/.tmp