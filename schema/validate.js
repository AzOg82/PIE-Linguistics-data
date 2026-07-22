#!/usr/bin/env node
/**
 * Validates PIE root entries against pie_root_schema.json.
 *
 * Usage:
 *   node validate.js <path-to-json-or-jsonl-file> [...more files]
 *
 * Accepts either:
 *   - A single JSON file containing one entry (object) or an array of entries.
 *   - A .jsonl file with one entry object per line.
 *
 * Exits with code 0 if all entries are valid, 1 otherwise.
 * Designed to run in a GitHub Actions step, e.g.:
 *   - run: node validate.js data/pie_roots_verification.json
 */

const fs = require("fs");
const path = require("path");
const Ajv = require("ajv");

const SCHEMA_PATH = path.join(__dirname, "pie_root_schema.json");

function loadEntries(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  if (filePath.endsWith(".jsonl")) {
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line, i) => {
        try {
          return JSON.parse(line);
        } catch (err) {
          throw new Error(`Line ${i + 1} of ${filePath} is not valid JSON: ${err.message}`);
        }
      });
  }

  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function extraSemanticChecks(entry, idx, filePath) {
  const problems = [];

  // iecor_verified entries must not be gloss-match-only
  if (
    entry.verification_tier === "iecor_verified" &&
    entry.confidence &&
    entry.confidence.gloss_match_only === true
  ) {
    problems.push(
      `entry[${idx}] (${entry.root || "?"}): verification_tier is 'iecor_verified' but confidence.gloss_match_only is true — these are contradictory.`
    );
  }

  // every lang code used in correspondence_sets.values should appear in cognate_set
  if (Array.isArray(entry.cognate_set) && Array.isArray(entry.correspondence_sets)) {
    const cognateLangs = new Set(entry.cognate_set.map((c) => c.lang));
    entry.correspondence_sets.forEach((cs, csIdx) => {
      if (cs.values) {
        Object.keys(cs.values).forEach((lang) => {
          if (!cognateLangs.has(lang)) {
            problems.push(
              `entry[${idx}] (${entry.root || "?"}): correspondence_sets[${csIdx}] references lang '${lang}' not present in cognate_set.`
            );
          }
        });
      }
    });
  }

  return problems;
}

function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("Usage: node validate.js <file.json|file.jsonl> [...more files]");
    process.exit(1);
  }

  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validateFn = ajv.compile(schema);

  let totalEntries = 0;
  let totalErrors = 0;

  for (const filePath of files) {
    let entries;
    try {
      entries = loadEntries(filePath);
    } catch (err) {
      console.error(`✗ Could not read ${filePath}: ${err.message}`);
      totalErrors += 1;
      continue;
    }

    entries.forEach((entry, idx) => {
      totalEntries += 1;
      const valid = validateFn(entry);
      const schemaProblems = valid
        ? []
        : validateFn.errors.map((e) => `entry[${idx}] (${entry.root || "?"}): ${e.instancePath || "/"} ${e.message}`);
      const semanticProblems = extraSemanticChecks(entry, idx, filePath);
      const allProblems = [...schemaProblems, ...semanticProblems];

      if (allProblems.length === 0) {
        console.log(`✓ ${filePath} entry[${idx}] (${entry.root}) valid`);
      } else {
        totalErrors += allProblems.length;
        allProblems.forEach((p) => console.error(`✗ ${filePath}: ${p}`));
      }
    });
  }

  console.log(`\n${totalEntries} entr${totalEntries === 1 ? "y" : "ies"} checked, ${totalErrors} problem(s) found.`);
  process.exit(totalErrors > 0 ? 1 : 0);
}

main();
