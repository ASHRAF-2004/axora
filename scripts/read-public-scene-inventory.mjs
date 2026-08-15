import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

function unwrap(expression) {
  let current = expression;
  while (ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

function variableInitializer(sourceFile, name) {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name && declaration.initializer) return unwrap(declaration.initializer);
    }
  }
  throw new Error(`Unable to derive ${name} from the public scene source.`);
}

function stringArray(expression) {
  const value = unwrap(expression);
  if (!ts.isArrayLiteralExpression(value) || value.elements.some((element) => !ts.isStringLiteral(element))) throw new Error("Public scene model inventory must use literal string arrays.");
  return value.elements.map((element) => element.text);
}

export function readPublicSceneModelInventory(repositoryRoot) {
  const sourcePath = path.join(repositoryRoot, "src/lib/immersive-public-experience.ts");
  const source = readFileSync(sourcePath, "utf8");
  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const workflow = stringArray(variableInitializer(sourceFile, "WORKFLOW_STAGE_IDS"));
  const sceneModels = variableInitializer(sourceFile, "PUBLIC_SCENE_MODELS");
  if (!ts.isObjectLiteralExpression(sceneModels)) throw new Error("PUBLIC_SCENE_MODELS must remain an object literal.");
  const inventory = {};
  for (const property of sceneModels.properties) {
    if (!ts.isPropertyAssignment(property)) throw new Error("PUBLIC_SCENE_MODELS contains a nonliteral property.");
    const route = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : null;
    if (!route) throw new Error("PUBLIC_SCENE_MODELS contains an unsupported route key.");
    const initializer = unwrap(property.initializer);
    inventory[route] = ts.isIdentifier(initializer) && initializer.text === "WORKFLOW_STAGE_IDS" ? [...workflow] : stringArray(initializer);
  }
  return inventory;
}
