function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clampScore(value) {
  return clamp(Math.round(value), 0, 100);
}

function scoreToSeverity(score) {
  if (score < 60) {
    return "critical";
  }
  if (score < 80) {
    return "warning";
  }
  return "positive";
}

function scoreToGrade(score) {
  if (score >= 88) {
    return "A";
  }
  if (score >= 75) {
    return "B";
  }
  if (score >= 62) {
    return "C";
  }
  if (score >= 50) {
    return "D";
  }
  return "F";
}

function buildFinding({ id, title, score, reason, evidence }) {
  return {
    id,
    title,
    score,
    severity: scoreToSeverity(score),
    reason,
    evidence,
  };
}

function scoreSpacing(spacing) {
  if (!spacing.gapCount) {
    return buildFinding({
      id: "spacing-consistency",
      title: "Limited spacing signal",
      score: 72,
      reason: "The page exposes too few visible section gaps to judge vertical rhythm confidently.",
      evidence: { gapCount: spacing.gapCount },
    });
  }

  let score = 92;
  const variationRatio = spacing.gapMean > 0 ? spacing.gapStdDev / spacing.gapMean : 1;
  score -= Math.min(36, variationRatio * 48);
  score -= spacing.smallGapCount * 6;
  score -= spacing.largeGapCount * 5;
  score -= spacing.irregularGapCount * 4;

  const finalScore = clampScore(score);
  return buildFinding({
    id: "spacing-consistency",
    title: finalScore >= 80 ? "Consistent vertical rhythm" : "Inconsistent vertical rhythm",
    score: finalScore,
    reason: finalScore >= 80
      ? "Adjacent sections use a fairly steady gap pattern, which keeps the page rhythm consistent."
      : "Large variance in adjacent section gaps makes the vertical rhythm feel uneven.",
    evidence: {
      gapCount: spacing.gapCount,
      gapMean: spacing.gapMean,
      gapStdDev: spacing.gapStdDev,
      smallGapCount: spacing.smallGapCount,
      largeGapCount: spacing.largeGapCount,
      irregularGapCount: spacing.irregularGapCount,
    },
  });
}

function scoreTypography(typography) {
  let score = 96;
  score -= Math.max(0, typography.uniqueFontSizeCount - 5) * 7;
  score -= typography.headingLevelSkips * 6;
  score -= typography.wideMeasureCount * 5;
  if (typography.bodyFontSize && (typography.bodyFontSize < 14 || typography.bodyFontSize > 20)) {
    score -= 8;
  }
  if (
    typography.headingToBodyRatio &&
    (typography.headingToBodyRatio < 1.35 || typography.headingToBodyRatio > 2.8)
  ) {
    score -= 12;
  }
  if (
    typography.averageLineHeightRatio &&
    (typography.averageLineHeightRatio < 1.2 || typography.averageLineHeightRatio > 1.9)
  ) {
    score -= 10;
  }

  const finalScore = clampScore(score);
  return buildFinding({
    id: "typography-scale",
    title: finalScore >= 80 ? "Controlled typography scale" : "Noisy typography scale",
    score: finalScore,
    reason: finalScore >= 80
      ? "The type scale stays restrained and text blocks keep a readable measure."
      : "The type scale or line measure is noisy enough to make the page feel less intentional.",
    evidence: {
      uniqueFontSizeCount: typography.uniqueFontSizeCount,
      bodyFontSize: typography.bodyFontSize,
      headingToBodyRatio: typography.headingToBodyRatio,
      averageLineHeightRatio: typography.averageLineHeightRatio,
      averageMeasureChars: typography.averageMeasureChars,
      wideMeasureCount: typography.wideMeasureCount,
      headingLevelSkips: typography.headingLevelSkips,
    },
  });
}

function scoreContrast(contrast) {
  let score = 97;
  score -= contrast.aaFailures * 12;
  score -= contrast.largeTextFailures * 8;
  if (contrast.worstRatio < 4.5) {
    score -= (4.5 - contrast.worstRatio) * 18;
  }

  const finalScore = clampScore(score);
  return buildFinding({
    id: "contrast-readability",
    title: finalScore >= 80 ? "Readable text contrast" : "Weak text contrast",
    score: finalScore,
    reason: finalScore >= 80
      ? "Most sampled text stays above expected contrast thresholds."
      : "Some visible text falls below WCAG-style contrast thresholds against its computed background.",
    evidence: {
      sampledTextNodes: contrast.sampledTextNodes,
      aaFailures: contrast.aaFailures,
      largeTextFailures: contrast.largeTextFailures,
      worstRatio: contrast.worstRatio,
      lowContrastSamples: contrast.lowContrastSamples,
    },
  });
}

function scoreLayout(layout, image) {
  let score = 95;
  score -= Math.max(0, layout.elementsPerViewport - 40) * 1.1;
  score -= Math.max(0, layout.textDensity - 0.18) * 120;
  score -= Math.max(0, image.occupiedRatio - 0.82) * 90;
  score -= Math.max(0, image.edgeDensity - 0.16) * 180;

  const finalScore = clampScore(score);
  return buildFinding({
    id: "layout-density",
    title: finalScore >= 80 ? "Comfortable visual density" : "Crowded visual density",
    score: finalScore,
    reason: finalScore >= 80
      ? "The page keeps enough breathing room between elements and avoids obvious visual clutter."
      : "Element density and edge activity suggest the page is visually crowded.",
    evidence: {
      visibleElementCount: layout.visibleElementCount,
      elementsPerViewport: layout.elementsPerViewport,
      textDensity: layout.textDensity,
      occupiedRatio: image.occupiedRatio,
      edgeDensity: image.edgeDensity,
    },
  });
}

function scoreColor(color, image) {
  let score = 95;
  score -= Math.max(0, color.distinctTextColors - 4) * 6;
  score -= Math.max(0, color.distinctSurfaceColors - 5) * 5;
  score -= Math.max(0, image.dominantColorCount - 7) * 4;
  score -= Math.max(0, image.saturationSpread - 0.24) * 65;

  const finalScore = clampScore(score);
  return buildFinding({
    id: "color-discipline",
    title: finalScore >= 80 ? "Disciplined color palette" : "Overextended color palette",
    score: finalScore,
    reason: finalScore >= 80
      ? "The palette stays reasonably disciplined without relying on excessive color variety."
      : "Too many competing colors or large saturation swings make the palette feel less cohesive.",
    evidence: {
      distinctTextColors: color.distinctTextColors,
      distinctSurfaceColors: color.distinctSurfaceColors,
      dominantColorCount: image.dominantColorCount,
      meanSaturation: image.meanSaturation,
      saturationSpread: image.saturationSpread,
    },
  });
}

function scoreBalance(layout, image, aboveFold) {
  let score = 95;
  score -= (1 - image.leftRightBalance) * 45;
  score -= (1 - image.topBottomBalance) * 45;
  score -= Math.max(0, layout.alignmentVariance - 36) * 0.5;
  score -= Math.max(0, aboveFold.coverageRatio - 0.88) * 70;
  if (image.whitespaceRatio < 0.12) {
    score -= (0.12 - image.whitespaceRatio) * 120;
  }

  const finalScore = clampScore(score);
  return buildFinding({
    id: "visual-balance",
    title: finalScore >= 80 ? "Balanced composition" : "Unbalanced composition",
    score: finalScore,
    reason: finalScore >= 80
      ? "Visual weight is distributed fairly evenly and the page keeps a usable amount of whitespace."
      : "Uneven visual weight or weak whitespace balance makes the composition feel unstable.",
    evidence: {
      leftRightBalance: image.leftRightBalance,
      topBottomBalance: image.topBottomBalance,
      whitespaceRatio: image.whitespaceRatio,
      alignmentVariance: layout.alignmentVariance,
      aboveFoldCoverageRatio: aboveFold.coverageRatio,
    },
  });
}

function scoreStructure(layout, aboveFold) {
  let score = 92;
  if (!layout.headingCount) {
    score -= 24;
  }
  if (!layout.heroSectionCount) {
    score -= 14;
  }
  if (!layout.prominentCtaCount) {
    score -= 10;
  }
  score -= Math.max(0, layout.longTextBlockCount - 1) * 7;
  if (!aboveFold.hasHeading) {
    score -= 10;
  }
  if (!aboveFold.hasPrimaryAction) {
    score -= 8;
  }

  const finalScore = clampScore(score);
  return buildFinding({
    id: "content-structure",
    title: finalScore >= 80 ? "Clear compositional hierarchy" : "Weak compositional hierarchy",
    score: finalScore,
    reason: finalScore >= 80
      ? "The page establishes a readable top section and enough hierarchy to guide the eye."
      : "The page lacks strong sectioning cues, CTA emphasis, or above-the-fold hierarchy.",
    evidence: {
      sectionCount: layout.sectionCount,
      headingCount: layout.headingCount,
      heroSectionCount: layout.heroSectionCount,
      prominentCtaCount: layout.prominentCtaCount,
      longTextBlockCount: layout.longTextBlockCount,
      aboveFoldHasHeading: aboveFold.hasHeading,
      aboveFoldHasPrimaryAction: aboveFold.hasPrimaryAction,
    },
  });
}

function scoreOverflow(overflow) {
  let score = 96;
  score -= overflow.horizontalOverflowCount * 18;
  score -= overflow.clippedTextCount * 10;
  score -= overflow.offscreenFixedCount * 12;

  const finalScore = clampScore(score);
  return buildFinding({
    id: "overflow-safety",
    title: finalScore >= 80 ? "Contained layout bounds" : "Overflow or clipping risk",
    score: finalScore,
    reason: finalScore >= 80
      ? "Visible layout elements stay within the viewport and text clipping risk is low."
      : "Some elements extend beyond the viewport or text containers appear clipped.",
    evidence: {
      horizontalOverflowCount: overflow.horizontalOverflowCount,
      clippedTextCount: overflow.clippedTextCount,
      offscreenFixedCount: overflow.offscreenFixedCount,
      clippedSamples: overflow.clippedSamples,
    },
  });
}

function scoreTapTargets(tapTargets) {
  let score = 96;
  score -= tapTargets.undersizedCount * 10;
  score -= tapTargets.crowdedCount * 8;

  const finalScore = clampScore(score);
  return buildFinding({
    id: "tap-targets",
    title: finalScore >= 80 ? "Comfortable tap targets" : "Small or crowded tap targets",
    score: finalScore,
    reason: finalScore >= 80
      ? "Interactive elements mostly meet touch-friendly size and spacing expectations."
      : "Some controls appear too small or too tightly packed for comfortable touch interaction.",
    evidence: {
      sampledCount: tapTargets.sampledCount,
      undersizedCount: tapTargets.undersizedCount,
      crowdedCount: tapTargets.crowdedCount,
      smallestTarget: tapTargets.smallestTarget,
    },
  });
}

function scoreAssets(assets, diagnostics) {
  let score = 95;
  score -= diagnostics.requestFailureCount * 18;
  score -= diagnostics.pageErrorCount * 12;
  score -= diagnostics.consoleErrorCount * 6;
  score -= assets.missingImageCount * 8;
  score -= assets.slowResourceCount * 4;
  score -= assets.fontLoadIssueCount * 6;

  const finalScore = clampScore(score);
  return buildFinding({
    id: "asset-health",
    title: finalScore >= 80 ? "Healthy loading profile" : "Loading or asset issues detected",
    score: finalScore,
    reason: finalScore >= 80
      ? "Asset loading looks reasonably healthy and the page did not surface major runtime issues."
      : "The page shows failed requests, missing assets, or slow-loading resources that can degrade polish.",
    evidence: {
      requestFailureCount: diagnostics.requestFailureCount,
      pageErrorCount: diagnostics.pageErrorCount,
      consoleErrorCount: diagnostics.consoleErrorCount,
      missingImageCount: assets.missingImageCount,
      slowResourceCount: assets.slowResourceCount,
      fontLoadIssueCount: assets.fontLoadIssueCount,
    },
  });
}

function scoreAccessibility(accessibilityChecks) {
  let score = 94;
  score -= accessibilityChecks.imagesMissingAlt * 6;
  score -= accessibilityChecks.unlabeledButtons * 8;
  score -= accessibilityChecks.unlabeledInputs * 10;
  score -= accessibilityChecks.duplicateIdCount * 10;
  score -= accessibilityChecks.headingLevelSkips * 4;

  const finalScore = clampScore(score);
  return buildFinding({
    id: "accessibility-basics",
    title: finalScore >= 80 ? "Solid basic accessibility hygiene" : "Accessibility hygiene gaps",
    score: finalScore,
    reason: finalScore >= 80
      ? "The page avoids the most common low-effort accessibility mistakes."
      : "The page still has basic accessibility issues such as missing labels, missing alt text, or duplicate IDs.",
    evidence: {
      imagesMissingAlt: accessibilityChecks.imagesMissingAlt,
      unlabeledButtons: accessibilityChecks.unlabeledButtons,
      unlabeledInputs: accessibilityChecks.unlabeledInputs,
      duplicateIdCount: accessibilityChecks.duplicateIdCount,
      headingLevelSkips: accessibilityChecks.headingLevelSkips,
    },
  });
}

function buildDiagnostics(consoleMessages, pageErrors, requestFailures) {
  return {
    consoleErrorCount: consoleMessages.filter((message) => ["error", "warning"].includes(message.type)).length,
    pageErrorCount: pageErrors.length,
    requestFailureCount: requestFailures.length,
  };
}

function withDefaultDomMetrics(dom = {}) {
  return {
    spacing: {
      gapCount: 0,
      gapMean: 0,
      gapStdDev: 0,
      smallGapCount: 0,
      largeGapCount: 0,
      irregularGapCount: 0,
      ...dom.spacing,
    },
    typography: {
      uniqueFontSizeCount: 0,
      fontSizes: [],
      bodyFontSize: null,
      headingToBodyRatio: null,
      averageLineHeightRatio: null,
      averageMeasureChars: null,
      wideMeasureCount: 0,
      headingLevelSkips: 0,
      ...dom.typography,
    },
    color: {
      distinctTextColors: 0,
      distinctSurfaceColors: 0,
      flatBackground: true,
      ...dom.color,
    },
    contrast: {
      sampledTextNodes: 0,
      aaFailures: 0,
      largeTextFailures: 0,
      worstRatio: 21,
      lowContrastSamples: [],
      ...dom.contrast,
    },
    layout: {
      page: {
        url: null,
        title: null,
        selector: "body",
        viewport: null,
        ...dom.layout?.page,
      },
      visibleElementCount: 0,
      elementsPerViewport: 0,
      textDensity: 0,
      sectionCount: 0,
      headingCount: 0,
      longTextBlockCount: 0,
      heroSectionCount: 0,
      prominentCtaCount: 0,
      alignmentVariance: 0,
      centeredBlockRatio: 0,
      occupiedAreaRatio: 0,
      dominantLeftEdges: [],
      ...dom.layout,
      page: {
        url: null,
        title: null,
        selector: "body",
        viewport: null,
        ...dom.layout?.page,
      },
    },
    overflow: {
      horizontalOverflowCount: 0,
      clippedTextCount: 0,
      offscreenFixedCount: 0,
      clippedSamples: [],
      ...dom.overflow,
    },
    tapTargets: {
      sampledCount: 0,
      undersizedCount: 0,
      crowdedCount: 0,
      smallestTarget: null,
      ...dom.tapTargets,
    },
    aboveFold: {
      hasHeading: false,
      hasPrimaryAction: false,
      mediaCount: 0,
      headingCount: 0,
      actionCount: 0,
      coverageRatio: 0,
      ...dom.aboveFold,
    },
    assets: {
      resourceCount: 0,
      slowResourceCount: 0,
      imageResourceCount: 0,
      fontResourceCount: 0,
      stylesheetResourceCount: 0,
      scriptResourceCount: 0,
      missingImageCount: 0,
      fontLoadIssueCount: 0,
      ...dom.assets,
    },
    accessibilityChecks: {
      imagesMissingAlt: 0,
      unlabeledButtons: 0,
      unlabeledInputs: 0,
      duplicateIdCount: 0,
      headingLevelSkips: dom.typography?.headingLevelSkips ?? 0,
      ...dom.accessibilityChecks,
    },
  };
}

function withDefaultImageMetrics(image = {}) {
  return {
    sampleWidth: 0,
    sampleHeight: 0,
    whitespaceRatio: 1,
    occupiedRatio: 0,
    edgeDensity: 0,
    dominantColorCount: 0,
    meanSaturation: 0,
    saturationSpread: 0,
    leftRightBalance: 1,
    topBottomBalance: 1,
    ...image,
  };
}

export function buildAestheticAnalysis({ dom, image, accessibility, consoleMessages = [], pageErrors = [], requestFailures = [] }) {
  const normalizedDom = withDefaultDomMetrics(dom);
  const normalizedImage = withDefaultImageMetrics(image);
  const diagnostics = buildDiagnostics(consoleMessages, pageErrors, requestFailures);
  const findings = [
    scoreSpacing(normalizedDom.spacing),
    scoreTypography(normalizedDom.typography),
    scoreContrast(normalizedDom.contrast),
    scoreLayout(normalizedDom.layout, normalizedImage),
    scoreColor(normalizedDom.color, normalizedImage),
    scoreBalance(normalizedDom.layout, normalizedImage, normalizedDom.aboveFold),
    scoreStructure(normalizedDom.layout, normalizedDom.aboveFold),
    scoreOverflow(normalizedDom.overflow),
    scoreTapTargets(normalizedDom.tapTargets),
    scoreAssets(normalizedDom.assets, diagnostics),
    scoreAccessibility(normalizedDom.accessibilityChecks),
  ];

  const weights = new Map([
    ["spacing-consistency", 0.1],
    ["typography-scale", 0.12],
    ["contrast-readability", 0.12],
    ["layout-density", 0.1],
    ["color-discipline", 0.08],
    ["visual-balance", 0.12],
    ["content-structure", 0.08],
    ["overflow-safety", 0.08],
    ["tap-targets", 0.07],
    ["asset-health", 0.07],
    ["accessibility-basics", 0.06],
  ]);
  const overallScore = clampScore(
    findings.reduce((total, finding) => total + finding.score * (weights.get(finding.id) ?? 0), 0),
  );

  return {
    summary: {
      overallScore,
      grade: scoreToGrade(overallScore),
      primarySignals: findings
        .slice()
        .sort((left, right) => left.score - right.score)
        .slice(0, 4)
        .map((finding) => finding.id),
    },
    findings,
    metrics: {
      spacing: normalizedDom.spacing,
      typography: normalizedDom.typography,
      color: normalizedDom.color,
      layout: normalizedDom.layout,
      image: normalizedImage,
      contrast: normalizedDom.contrast,
      overflow: normalizedDom.overflow,
      tapTargets: normalizedDom.tapTargets,
      aboveFold: normalizedDom.aboveFold,
      assets: normalizedDom.assets,
      accessibilityChecks: normalizedDom.accessibilityChecks,
      diagnostics,
    },
    accessibility: accessibility
      ? {
          format: "aria-snapshot",
          snapshot: accessibility,
        }
      : null,
  };
}

async function collectDomMetrics(targetLocator, selector, viewport) {
  return targetLocator.evaluate(
    (root, input) => {
      function roundInner(value, digits = 2) {
        const factor = 10 ** digits;
        return Math.round(value * factor) / factor;
      }

      function normalizeText(value) {
        return value.replace(/\s+/g, " ").trim();
      }

      function isVisible(element) {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          Number.parseFloat(style.opacity || "1") > 0.02 &&
          rect.width > 2 &&
          rect.height > 2
        );
      }

      function parseColor(color) {
        if (!color || color === "transparent") {
          return null;
        }
        const matches = color.match(/[\d.]+/g);
        if (!matches || matches.length < 3) {
          return null;
        }
        const [red, green, blue, alpha = "1"] = matches.map(Number);
        return { red, green, blue, alpha };
      }

      function quantizeColor(color) {
        const parsed = parseColor(color);
        if (!parsed || parsed.alpha <= 0.05) {
          return null;
        }
        const bucket = (value) => Math.round(value / 32) * 32;
        return `${bucket(parsed.red)},${bucket(parsed.green)},${bucket(parsed.blue)}`;
      }

      function blendColors(foreground, background) {
        const alpha = foreground.alpha;
        return {
          red: foreground.red * alpha + background.red * (1 - alpha),
          green: foreground.green * alpha + background.green * (1 - alpha),
          blue: foreground.blue * alpha + background.blue * (1 - alpha),
          alpha: 1,
        };
      }

      function relativeLuminance(color) {
        const normalize = (channel) => {
          const value = channel / 255;
          return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        };
        const red = normalize(color.red);
        const green = normalize(color.green);
        const blue = normalize(color.blue);
        return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      }

      function contrastRatio(foreground, background) {
        const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
        const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
        return (lighter + 0.05) / (darker + 0.05);
      }

      function effectiveBackgroundColor(element) {
        let current = element;
        let background = { red: 255, green: 255, blue: 255, alpha: 1 };
        while (current) {
          const parsed = parseColor(window.getComputedStyle(current).backgroundColor);
          if (parsed && parsed.alpha > 0.01) {
            background = parsed.alpha >= 0.99 ? parsed : blendColors(parsed, background);
            if (parsed.alpha >= 0.99) {
              break;
            }
          }
          current = current.parentElement;
        }
        return background;
      }

      function accessibleName(element) {
        const ariaLabel = element.getAttribute("aria-label");
        if (ariaLabel) {
          return normalizeText(ariaLabel);
        }
        const labelledBy = element.getAttribute("aria-labelledby");
        if (labelledBy) {
          const value = labelledBy
            .split(/\s+/)
            .map((id) => document.getElementById(id))
            .filter(Boolean)
            .map((node) => normalizeText(node.textContent || ""))
            .join(" ");
          if (value) {
            return normalizeText(value);
          }
        }
        if ("alt" in element && typeof element.alt === "string" && element.alt) {
          return normalizeText(element.alt);
        }
        if ("value" in element && typeof element.value === "string" && element.value) {
          return normalizeText(element.value);
        }
        return normalizeText(element.innerText || element.textContent || element.getAttribute("title") || "");
      }

      function estimateMeasureChars(width, fontSize) {
        if (!width || !fontSize) {
          return 0;
        }
        return width / Math.max(1, fontSize * 0.55);
      }

      const rootRect = root.getBoundingClientRect();
      const viewportArea = Math.max(1, input.viewport.width * input.viewport.height);
      const allCandidates = [root, ...root.querySelectorAll("*")];
      const visibleElements = allCandidates.filter(
        (element) => element instanceof HTMLElement && isVisible(element),
      );
      const directSections = Array.from(root.children).filter(
        (element) =>
          element instanceof HTMLElement &&
          isVisible(element) &&
          element.getBoundingClientRect().height >= 24,
      );
      const majorBlocks = (directSections.length >= 2 ? directSections : visibleElements)
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          if (rect.width < Math.min(rootRect.width * 0.2, input.viewport.width * 0.2)) {
            return false;
          }
          return rect.height >= 28;
        })
        .sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top)
        .slice(0, 28);

      const gaps = [];
      for (let index = 1; index < majorBlocks.length; index += 1) {
        const previous = majorBlocks[index - 1].getBoundingClientRect();
        const current = majorBlocks[index].getBoundingClientRect();
        const gap = current.top - previous.bottom;
        if (gap > 4) {
          gaps.push(gap);
        }
      }
      const gapMean = gaps.length ? gaps.reduce((total, gap) => total + gap, 0) / gaps.length : 0;
      const gapStdDev = gaps.length
        ? Math.sqrt(gaps.reduce((total, gap) => total + ((gap - gapMean) ** 2), 0) / gaps.length)
        : 0;

      const textElements = visibleElements.filter((element) => {
        const text = normalizeText(element.innerText || "");
        return Boolean(text) && text.length >= 2;
      });
      const fontSizes = [];
      const lineHeightRatios = [];
      const measureChars = [];
      const headingLevels = [];
      const lowContrastSamples = [];
      const textColors = new Set();
      const surfaceColors = new Set();
      const leftOffsets = [];
      const leftBuckets = new Map();
      let bodyFontSize = null;
      let maxHeadingSize = null;
      let longTextBlockCount = 0;
      let prominentCtaCount = 0;
      let aaFailures = 0;
      let largeTextFailures = 0;
      let worstRatio = 21;
      let sampledTextNodes = 0;
      let centeredBlockCount = 0;
      let heroSectionCount = 0;
      let wideMeasureCount = 0;
      let imagesMissingAlt = 0;
      let unlabeledButtons = 0;
      let unlabeledInputs = 0;
      let horizontalOverflowCount = 0;
      let clippedTextCount = 0;
      let offscreenFixedCount = 0;
      let undersizedTapTargets = 0;
      let crowdedTapTargets = 0;
      let smallestTarget = null;
      let aboveFoldHeadingCount = 0;
      let aboveFoldActionCount = 0;
      let aboveFoldMediaCount = 0;
      let aboveFoldCoveredArea = 0;

      for (const element of visibleElements) {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        const background = quantizeColor(style.backgroundColor);
        if (background) {
          surfaceColors.add(background);
        }
        if (rect.right > input.viewport.width + 1 || rect.left < -1) {
          horizontalOverflowCount += 1;
        }
        if (style.position === "fixed" && (rect.left < 0 || rect.right > input.viewport.width || rect.top < 0)) {
          offscreenFixedCount += 1;
        }
        if (
          ["hidden", "clip", "auto"].includes(style.overflowX) &&
          element.scrollWidth > element.clientWidth + 2 &&
          normalizeText(element.innerText || "").length > 0
        ) {
          clippedTextCount += 1;
        }
        if (
          ["hidden", "clip", "auto"].includes(style.overflowY) &&
          element.scrollHeight > element.clientHeight + 2 &&
          normalizeText(element.innerText || "").length > 0
        ) {
          clippedTextCount += 1;
        }

        const inFirstViewport = rect.top < input.viewport.height && rect.bottom > 0;
        if (inFirstViewport) {
          aboveFoldCoveredArea += Math.max(0, Math.min(rect.bottom, input.viewport.height) - Math.max(rect.top, 0)) *
            Math.max(0, Math.min(rect.right, input.viewport.width) - Math.max(rect.left, 0));
          if (/^H[1-6]$/.test(element.tagName)) {
            aboveFoldHeadingCount += 1;
          }
          if (["IMG", "SVG", "PICTURE", "VIDEO"].includes(element.tagName)) {
            aboveFoldMediaCount += 1;
          }
        }
      }

      for (const element of textElements.slice(0, 80)) {
        const style = window.getComputedStyle(element);
        const text = normalizeText(element.innerText || "");
        const rect = element.getBoundingClientRect();
        const fontSize = Number.parseFloat(style.fontSize || "0");
        const lineHeight = Number.parseFloat(style.lineHeight || "0");
        if (fontSize > 0) {
          fontSizes.push(Math.round(fontSize));
        }
        if (fontSize > 0 && Number.isFinite(lineHeight) && lineHeight > 0) {
          lineHeightRatios.push(lineHeight / fontSize);
        }
        const measure = estimateMeasureChars(rect.width, fontSize);
        if (measure > 0) {
          measureChars.push(measure);
        }
        if (measure > 82) {
          wideMeasureCount += 1;
        }
        if (/^H[1-6]$/.test(element.tagName)) {
          const level = Number.parseInt(element.tagName.slice(1), 10);
          headingLevels.push(level);
          maxHeadingSize = maxHeadingSize === null ? fontSize : Math.max(maxHeadingSize, fontSize);
        } else if (
          bodyFontSize === null &&
          ["P", "LI", "DIV", "SPAN"].includes(element.tagName) &&
          text.length >= 24
        ) {
          bodyFontSize = fontSize;
        }
        if (text.length >= 240 && ["P", "LI", "BLOCKQUOTE", "DIV"].includes(element.tagName)) {
          longTextBlockCount += 1;
        }

        const textColor = parseColor(style.color);
        const backgroundColor = effectiveBackgroundColor(element);
        if (textColor && textColor.alpha > 0.1) {
          const ratio = contrastRatio(blendColors(textColor, backgroundColor), backgroundColor);
          sampledTextNodes += 1;
          worstRatio = Math.min(worstRatio, ratio);
          const fontWeight = Number.parseInt(style.fontWeight || "400", 10);
          const isLargeText = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 600);
          const threshold = isLargeText ? 3 : 4.5;
          if (ratio < threshold) {
            if (isLargeText) {
              largeTextFailures += 1;
            } else {
              aaFailures += 1;
            }
            if (lowContrastSamples.length < 3) {
              lowContrastSamples.push({
                text: text.slice(0, 80),
                ratio: roundInner(ratio, 2),
              });
            }
          }
        }

        const quantizedTextColor = quantizeColor(style.color);
        if (quantizedTextColor) {
          textColors.add(quantizedTextColor);
        }
      }

      let headingLevelSkips = 0;
      for (let index = 1; index < headingLevels.length; index += 1) {
        const step = headingLevels[index] - headingLevels[index - 1];
        if (step > 1) {
          headingLevelSkips += 1;
        }
      }

      for (const element of majorBlocks) {
        const rect = element.getBoundingClientRect();
        leftOffsets.push(rect.left);
        const bucket = Math.round(rect.left / 8) * 8;
        leftBuckets.set(bucket, (leftBuckets.get(bucket) ?? 0) + 1);
        const centerDelta = Math.abs(rect.left + rect.width / 2 - input.viewport.width / 2);
        if (centerDelta < 36) {
          centeredBlockCount += 1;
        }
        if (rect.top < input.viewport.height * 0.45) {
          const hasHeading = Boolean(element.querySelector("h1, h2, h3"));
          const hasVisual = Boolean(element.querySelector("img, svg, picture, video"));
          const hasAction = Boolean(element.querySelector("a, button, [role='button']"));
          if (hasHeading && (hasVisual || hasAction)) {
            heroSectionCount += 1;
          }
        }
      }

      for (const element of visibleElements) {
        if (!(element instanceof HTMLElement)) {
          continue;
        }

        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        const name = accessibleName(element);
        const clickable = ["A", "BUTTON", "INPUT"].includes(element.tagName) || element.getAttribute("role") === "button";
        if (clickable) {
          const minDimension = Math.min(rect.width, rect.height);
          if (minDimension > 0 && (smallestTarget === null || minDimension < smallestTarget)) {
            smallestTarget = roundInner(minDimension);
          }
          if (rect.width < 44 || rect.height < 44) {
            undersizedTapTargets += 1;
          }
          const nearby = visibleElements.some((candidate) => {
            if (candidate === element || !(candidate instanceof HTMLElement)) {
              return false;
            }
            const candidateRect = candidate.getBoundingClientRect();
            const candidateClickable =
              ["A", "BUTTON", "INPUT"].includes(candidate.tagName) || candidate.getAttribute("role") === "button";
            if (!candidateClickable) {
              return false;
            }
            const horizontalGap = Math.max(0, Math.max(rect.left, candidateRect.left) - Math.min(rect.right, candidateRect.right));
            const verticalGap = Math.max(0, Math.max(rect.top, candidateRect.top) - Math.min(rect.bottom, candidateRect.bottom));
            return horizontalGap < 8 && verticalGap < 8;
          });
          if (nearby) {
            crowdedTapTargets += 1;
          }
          const filled =
            quantizeColor(style.backgroundColor) !== null ||
            Number.parseInt(style.borderRadius || "0", 10) > 0 ||
            rect.height >= 36;
          if (filled && name.length >= 2 && rect.width >= 72) {
            prominentCtaCount += 1;
            if (rect.top < input.viewport.height && rect.bottom > 0) {
              aboveFoldActionCount += 1;
            }
          }
        }

        if (element.tagName === "IMG" && !element.getAttribute("alt")) {
          imagesMissingAlt += 1;
        }

        if (clickable && !name) {
          unlabeledButtons += 1;
        }
        if (
          ["INPUT", "SELECT", "TEXTAREA"].includes(element.tagName) &&
          element.getAttribute("type") !== "hidden"
        ) {
          const hasLabel = Boolean(element.closest("label")) ||
            Boolean(element.id && document.querySelector(`label[for="${CSS.escape(element.id)}"]`)) ||
            Boolean(name);
          if (!hasLabel) {
            unlabeledInputs += 1;
          }
        }
      }

      const ids = new Map();
      for (const element of visibleElements) {
        if (!(element instanceof HTMLElement) || !element.id) {
          continue;
        }
        ids.set(element.id, (ids.get(element.id) ?? 0) + 1);
      }
      const duplicateIdCount = Array.from(ids.values()).filter((count) => count > 1).length;

      const occupiedArea = majorBlocks.reduce((total, element) => {
        const rect = element.getBoundingClientRect();
        return total + Math.max(0, rect.width * rect.height);
      }, 0);
      const alignmentMean = leftOffsets.length
        ? leftOffsets.reduce((total, value) => total + value, 0) / leftOffsets.length
        : 0;
      const alignmentVariance = leftOffsets.length
        ? Math.sqrt(
            leftOffsets.reduce((total, value) => total + ((value - alignmentMean) ** 2), 0) /
              leftOffsets.length,
          )
        : 0;

      const resources = performance.getEntriesByType("resource");
      const imageElements = Array.from(root.querySelectorAll("img"));
      const missingImageCount = imageElements.filter((image) => image.complete && image.naturalWidth === 0).length;
      const fontLoadIssueCount = resources.filter((resource) => resource.initiatorType === "font" && resource.duration > 1500).length;
      const slowResourceCount = resources.filter((resource) => resource.duration > 1000).length;

      return {
        spacing: {
          selector: input.selector,
          gapCount: gaps.length,
          gapMean: roundInner(gapMean),
          gapStdDev: roundInner(gapStdDev),
          smallGapCount: gaps.filter((gap) => gap < 16).length,
          largeGapCount: gaps.filter((gap) => gap > 96).length,
          irregularGapCount: gaps.filter((gap) => Math.abs(gap - gapMean) > 24).length,
        },
        typography: {
          uniqueFontSizeCount: Array.from(new Set(fontSizes)).length,
          fontSizes: Array.from(new Set(fontSizes)).sort((left, right) => left - right),
          bodyFontSize: bodyFontSize ? roundInner(bodyFontSize) : null,
          headingToBodyRatio: bodyFontSize && maxHeadingSize ? roundInner(maxHeadingSize / bodyFontSize) : null,
          averageLineHeightRatio: lineHeightRatios.length
            ? roundInner(lineHeightRatios.reduce((total, value) => total + value, 0) / lineHeightRatios.length)
            : null,
          averageMeasureChars: measureChars.length
            ? roundInner(measureChars.reduce((total, value) => total + value, 0) / measureChars.length)
            : null,
          wideMeasureCount,
          headingLevelSkips,
        },
        color: {
          distinctTextColors: textColors.size,
          distinctSurfaceColors: surfaceColors.size,
          flatBackground: surfaceColors.size <= 1,
        },
        contrast: {
          sampledTextNodes,
          aaFailures,
          largeTextFailures,
          worstRatio: sampledTextNodes ? roundInner(worstRatio, 2) : 21,
          lowContrastSamples,
        },
        layout: {
          page: {
            url: window.location.href,
            title: document.title,
            selector: input.selector,
            viewport: input.viewport,
          },
          visibleElementCount: visibleElements.length,
          elementsPerViewport: roundInner(visibleElements.length / (viewportArea / 100000)),
          textDensity: roundInner(
            textElements.reduce((total, element) => total + normalizeText(element.innerText || "").length, 0) /
              viewportArea,
            4,
          ),
          sectionCount: majorBlocks.length,
          headingCount: headingLevels.length,
          longTextBlockCount,
          heroSectionCount,
          prominentCtaCount,
          alignmentVariance: roundInner(alignmentVariance),
          centeredBlockRatio: majorBlocks.length ? roundInner(centeredBlockCount / majorBlocks.length) : 0,
          occupiedAreaRatio: roundInner(Math.min(1, occupiedArea / viewportArea), 4),
          dominantLeftEdges: Array.from(leftBuckets.entries())
            .sort((left, right) => right[1] - left[1])
            .slice(0, 3)
            .map(([x, count]) => ({ x, count })),
        },
        overflow: {
          horizontalOverflowCount,
          clippedTextCount,
          offscreenFixedCount,
          clippedSamples: visibleElements
            .filter((element) => element.scrollWidth > element.clientWidth + 2 || element.scrollHeight > element.clientHeight + 2)
            .slice(0, 3)
            .map((element) => ({ tag: element.tagName.toLowerCase(), text: normalizeText(element.innerText || "").slice(0, 60) })),
        },
        tapTargets: {
          sampledCount: visibleElements.filter((element) =>
            ["A", "BUTTON", "INPUT"].includes(element.tagName) || element.getAttribute("role") === "button"
          ).length,
          undersizedCount: undersizedTapTargets,
          crowdedCount: crowdedTapTargets,
          smallestTarget,
        },
        aboveFold: {
          hasHeading: aboveFoldHeadingCount > 0,
          hasPrimaryAction: aboveFoldActionCount > 0,
          mediaCount: aboveFoldMediaCount,
          headingCount: aboveFoldHeadingCount,
          actionCount: aboveFoldActionCount,
          coverageRatio: roundInner(Math.min(1, aboveFoldCoveredArea / viewportArea), 4),
        },
        assets: {
          resourceCount: resources.length,
          slowResourceCount,
          imageResourceCount: resources.filter((resource) => resource.initiatorType === "img").length,
          fontResourceCount: resources.filter((resource) => resource.initiatorType === "font").length,
          stylesheetResourceCount: resources.filter((resource) => resource.initiatorType === "link").length,
          scriptResourceCount: resources.filter((resource) => resource.initiatorType === "script").length,
          missingImageCount,
          fontLoadIssueCount,
        },
        accessibilityChecks: {
          imagesMissingAlt,
          unlabeledButtons,
          unlabeledInputs,
          duplicateIdCount,
          headingLevelSkips,
        },
      };
    },
    {
      selector: selector ?? "body",
      viewport,
    },
  );
}

async function collectImageMetrics(page, screenshotBytes) {
  return page.evaluate(async (payload) => {
    function roundInner(value, digits = 2) {
      const factor = 10 ** digits;
      return Math.round(value * factor) / factor;
    }

    function rgbDistance(left, right) {
      const dr = left[0] - right[0];
      const dg = left[1] - right[1];
      const db = left[2] - right[2];
      return Math.sqrt((dr * dr) + (dg * dg) + (db * db));
    }

    function rgbToHsl(red, green, blue) {
      const r = red / 255;
      const g = green / 255;
      const b = blue / 255;
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const lightness = (max + min) / 2;
      if (max === min) {
        return { saturation: 0, lightness };
      }
      const delta = max - min;
      const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
      return { saturation, lightness };
    }

    const image = await new Promise((resolve, reject) => {
      const nextImage = new Image();
      nextImage.onload = () => resolve(nextImage);
      nextImage.onerror = () => reject(new Error("failed to decode inspect screenshot"));
      nextImage.src = payload.dataUrl;
    });

    const sampleWidth = 64;
    const sampleHeight = 64;
    const canvas = document.createElement("canvas");
    canvas.width = sampleWidth;
    canvas.height = sampleHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0, sampleWidth, sampleHeight);
    const data = context.getImageData(0, 0, sampleWidth, sampleHeight).data;

    const borderPixels = [];
    const samples = [];
    for (let y = 0; y < sampleHeight; y += 1) {
      for (let x = 0; x < sampleWidth; x += 1) {
        const index = (y * sampleWidth + x) * 4;
        const pixel = [data[index], data[index + 1], data[index + 2], data[index + 3]];
        samples.push(pixel);
        if (x === 0 || y === 0 || x === sampleWidth - 1 || y === sampleHeight - 1) {
          borderPixels.push(pixel);
        }
      }
    }

    const background = borderPixels.reduce(
      (accumulator, pixel) => {
        accumulator[0] += pixel[0];
        accumulator[1] += pixel[1];
        accumulator[2] += pixel[2];
        return accumulator;
      },
      [0, 0, 0],
    ).map((channel) => channel / Math.max(1, borderPixels.length));

    let occupiedCount = 0;
    let edgeCount = 0;
    let comparisons = 0;
    let leftWeight = 0;
    let rightWeight = 0;
    let topWeight = 0;
    let bottomWeight = 0;
    let saturationTotal = 0;
    const saturationValues = [];
    const colorBuckets = new Map();

    for (let y = 0; y < sampleHeight; y += 1) {
      for (let x = 0; x < sampleWidth; x += 1) {
        const index = (y * sampleWidth + x) * 4;
        const pixel = [data[index], data[index + 1], data[index + 2], data[index + 3]];
        const distance = rgbDistance(pixel, background);
        const occupied = distance > 34;
        if (occupied) {
          occupiedCount += 1;
        }

        const bucket = `${Math.round(pixel[0] / 32) * 32},${Math.round(pixel[1] / 32) * 32},${Math.round(pixel[2] / 32) * 32}`;
        colorBuckets.set(bucket, (colorBuckets.get(bucket) ?? 0) + 1);

        const { saturation } = rgbToHsl(pixel[0], pixel[1], pixel[2]);
        saturationTotal += saturation;
        saturationValues.push(saturation);

        const weight = occupied ? distance : distance * 0.2;
        if (x < sampleWidth / 2) {
          leftWeight += weight;
        } else {
          rightWeight += weight;
        }
        if (y < sampleHeight / 2) {
          topWeight += weight;
        } else {
          bottomWeight += weight;
        }

        if (x > 0) {
          const leftIndex = index - 4;
          const leftPixel = [data[leftIndex], data[leftIndex + 1], data[leftIndex + 2]];
          if (rgbDistance(pixel, leftPixel) > 22) {
            edgeCount += 1;
          }
          comparisons += 1;
        }
        if (y > 0) {
          const topIndex = index - sampleWidth * 4;
          const topPixel = [data[topIndex], data[topIndex + 1], data[topIndex + 2]];
          if (rgbDistance(pixel, topPixel) > 22) {
            edgeCount += 1;
          }
          comparisons += 1;
        }
      }
    }

    const saturationMean = saturationTotal / Math.max(1, saturationValues.length);
    const saturationVariance =
      saturationValues.reduce((total, value) => total + ((value - saturationMean) ** 2), 0) /
      Math.max(1, saturationValues.length);
    const totalWeight = Math.max(1, leftWeight + rightWeight);
    const verticalWeight = Math.max(1, topWeight + bottomWeight);

    return {
      sampleWidth,
      sampleHeight,
      whitespaceRatio: roundInner(1 - occupiedCount / samples.length, 4),
      occupiedRatio: roundInner(occupiedCount / samples.length, 4),
      edgeDensity: roundInner(edgeCount / Math.max(1, comparisons), 4),
      dominantColorCount: Array.from(colorBuckets.values()).filter((count) => count / samples.length >= 0.01).length,
      meanSaturation: roundInner(saturationMean, 4),
      saturationSpread: roundInner(Math.sqrt(saturationVariance), 4),
      leftRightBalance: roundInner(1 - Math.abs(leftWeight - rightWeight) / totalWeight, 4),
      topBottomBalance: roundInner(1 - Math.abs(topWeight - bottomWeight) / verticalWeight, 4),
    };
  }, { dataUrl: `data:image/jpeg;base64,${screenshotBytes.toString("base64")}` });
}

async function collectAccessibilitySnapshot(targetLocator, timeoutMs) {
  if (typeof targetLocator.ariaSnapshot !== "function") {
    return null;
  }
  try {
    return await targetLocator.ariaSnapshot({ timeout: timeoutMs });
  } catch {
    return null;
  }
}

export async function createInspectArtifact({
  page,
  targetLocator,
  request,
  consoleMessages = [],
  pageErrors = [],
  requestFailures = [],
}) {
  const dom = await collectDomMetrics(targetLocator, request.selector, request.viewport);
  const screenshotBytes = await page.screenshot({
    type: "jpeg",
    quality: 70,
    fullPage: request.fullPage,
    clip: request.clip,
  });
  const image = await collectImageMetrics(page, screenshotBytes);
  const accessibility = await collectAccessibilitySnapshot(targetLocator, request.timeoutMs);
  const analysis = buildAestheticAnalysis({
    dom,
    image,
    accessibility,
    consoleMessages,
    pageErrors,
    requestFailures,
  });

  return {
    contentType: "application/json; charset=utf-8",
    analysis,
  };
}
