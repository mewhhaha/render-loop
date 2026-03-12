import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { buildAestheticAnalysis } from "../src/inspect.js";

test("buildAestheticAnalysis flags a noisy fixture scenario", async () => {
  const fixturePath = path.resolve("fixtures/aesthetic-issues.html");
  const fixtureHtml = await fs.readFile(fixturePath, "utf8");
  assert.match(fixtureHtml, /Uneven polish/);
  assert.match(fixtureHtml, /crowded-grid/);

  const analysis = buildAestheticAnalysis({
    dom: {
      spacing: {
        selector: "body",
        gapCount: 3,
        gapMean: 44,
        gapStdDev: 31,
        smallGapCount: 1,
        largeGapCount: 1,
      },
      typography: {
        uniqueFontSizeCount: 7,
        fontSizes: [12, 13, 14, 15, 18, 27, 52],
        bodyFontSize: 13,
        headingToBodyRatio: 4,
        averageLineHeightRatio: 1.11,
        headingLevelSkips: 1,
      },
      color: {
        distinctTextColors: 5,
        distinctSurfaceColors: 6,
        flatBackground: false,
      },
      contrast: {
        sampledTextNodes: 8,
        aaFailures: 1,
        largeTextFailures: 0,
        worstRatio: 3.92,
        lowContrastSamples: [
          {
            text: "Soft gray body copy",
            ratio: 3.92,
          },
        ],
      },
      layout: {
        page: {
          url: "http://fixture.local/aesthetic-issues",
          title: "Aesthetic Issues Fixture",
          selector: "body",
          viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
        },
        visibleElementCount: 96,
        elementsPerViewport: 10.6,
        textDensity: 0.24,
        sectionCount: 4,
        headingCount: 3,
        longTextBlockCount: 2,
        heroSectionCount: 1,
        prominentCtaCount: 1,
        alignmentVariance: 74,
        centeredBlockRatio: 0.25,
        occupiedAreaRatio: 0.84,
      },
      overflow: {
        horizontalOverflowCount: 1,
        clippedTextCount: 2,
        offscreenFixedCount: 1,
        clippedSamples: [{ tag: "div", text: "Oversized promo strip" }],
      },
      tapTargets: {
        sampledCount: 6,
        undersizedCount: 2,
        crowdedCount: 1,
        smallestTarget: { width: 28, height: 30 },
      },
      aboveFold: {
        hasHeading: true,
        hasPrimaryAction: false,
        mediaCount: 1,
        headingCount: 1,
        actionCount: 0,
        coverageRatio: 0.94,
      },
      assets: {
        resourceCount: 14,
        slowResourceCount: 2,
        imageResourceCount: 4,
        fontResourceCount: 1,
        stylesheetResourceCount: 2,
        scriptResourceCount: 3,
        missingImageCount: 1,
        fontLoadIssueCount: 1,
      },
      accessibilityChecks: {
        imagesMissingAlt: 1,
        unlabeledButtons: 1,
        unlabeledInputs: 0,
        duplicateIdCount: 1,
        headingLevelSkips: 1,
      },
    },
    image: {
      sampleWidth: 64,
      sampleHeight: 64,
      whitespaceRatio: 0.1,
      occupiedRatio: 0.9,
      edgeDensity: 0.23,
      dominantColorCount: 9,
      meanSaturation: 0.44,
      saturationSpread: 0.29,
      leftRightBalance: 0.68,
      topBottomBalance: 0.59,
    },
    accessibility: "- main:\n  - heading \"Aesthetic Issues Fixture\" [level=1]",
    consoleMessages: [{ type: "warning", text: "font fallback in use" }],
    requestFailures: [{ url: "https://cdn.example.com/hero.jpg", method: "GET", failureText: "net::ERR_FAILED" }],
  });

  assert.equal(analysis.summary.grade, "D");
  assert.deepEqual(analysis.summary.primarySignals, [
    "visual-balance",
    "typography-scale",
    "overflow-safety",
    "spacing-consistency",
  ]);
  assert.equal(analysis.findings.find((finding) => finding.id === "layout-density").severity, "warning");
  assert.equal(analysis.findings.find((finding) => finding.id === "typography-scale").severity, "critical");
  assert.equal(analysis.findings.find((finding) => finding.id === "contrast-readability").severity, "warning");
  assert.equal(analysis.findings.find((finding) => finding.id === "overflow-safety").severity, "critical");
  assert.equal(analysis.findings.find((finding) => finding.id === "asset-health").severity, "critical");
  assert.equal(analysis.accessibility.format, "aria-snapshot");
  assert.equal(analysis.metrics.assets.missingImageCount, 1);
  assert.equal(analysis.metrics.diagnostics.requestFailureCount, 1);
});
