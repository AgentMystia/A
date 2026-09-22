export interface OutputStyleConfig {
  name: string;
  description: string;
  content: string;
}

export interface OutputStyleInfo extends OutputStyleConfig {
  id: string;
  isBuiltIn: boolean;
  enabled: boolean;
  filePath?: string;
}

export const BUILTIN_OUTPUT_STYLES: readonly OutputStyleInfo[] = [
  {
    id: "default",
    name: "Default",
    description: "Claude completes coding tasks efficiently and provides concise responses",
    content: "",
    isBuiltIn: true,
    enabled: true,
  },
  {
    id: "explanatory",
    name: "Explanatory",
    description: "Claude explains its implementation choices and codebase patterns",
    content: "",
    isBuiltIn: true,
    enabled: false,
  },
  {
    id: "learning",
    name: "Learning",
    description: "Claude pauses and asks you to write small pieces of code for hands-on practice",
    content: "",
    isBuiltIn: true,
    enabled: false,
  },
];
