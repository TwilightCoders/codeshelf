// VS Code globalState keys — shared so extension.ts and the panel stay in sync.
export const STORAGE_KEYS = {
  cachedShelves: 'codeshelf.cachedShelves',
  posterPrompts: 'codeshelf.posterPrompts',
} as const;

export const PROJECT_MARKERS: Record<string, string> = {
  '.git': 'git',
  'package.json': 'javascript',
  'Gemfile': 'ruby',
  '.gemspec': 'ruby',
  'Cargo.toml': 'rust',
  'go.mod': 'go',
  'pyproject.toml': 'python',
  'setup.py': 'python',
  'mix.exs': 'elixir',
  'build.gradle': 'java',
  'pom.xml': 'java',
  'CMakeLists.txt': 'cpp',
  'Makefile': 'make',
  'composer.json': 'php',
  'pubspec.yaml': 'dart',
  'deno.json': 'deno',
};

export const GLOB_MARKERS = ['*.gemspec', '*.sln', '*.csproj', '*.xcodeproj', '*.xcworkspace', '*.code-workspace'];

// "Umbrella" markers identify a directory that is itself a single project made
// of sub-projects — a monorepo / multi-service repo you open as ONE unit, not a
// collection of independent projects. They are checked only when no regular
// PROJECT_MARKERS are present (precedence: regular markers > umbrella > recurse),
// so such a directory becomes one "super-project" card instead of being walked
// into as a shelf. (A multi-folder *.code-workspace is handled separately as a
// bookset; a single .git repo already collapses via PROJECT_MARKERS.)
export const UMBRELLA_MARKERS = new Set([
  'docker-compose.yml',
  'docker-compose.yaml',
  'turbo.json',
  'lerna.json',
  'pnpm-workspace.yaml',
  'nx.json',
]);

export const SKIP_DIRS = new Set([
  'node_modules', '.git', 'vendor', 'target', 'build', 'dist',
  '.bundle', '__pycache__', '.tox', '.venv', 'venv', '.next',
  'coverage', '.cache', 'tmp', 'log', 'logs',
]);

export const LANGUAGE_PRIORITY: string[] = [
  'rust', 'go', 'elixir', 'ruby', 'python', 'javascript',
  'java', 'cpp', 'dart', 'php', 'deno', 'make',
];

// Poster generation prompt parts — shared between extension host and webview
export const POSTER_SYSTEM_PROMPT = [
  'You are a graphic designer generating SVG poster artwork for a code project.',
  '',
  'WORKFLOW:',
  '1. First, explore the project directory. Read the README, look for logos/icons,',
  '   understand what the project does and its personality.',
  '2. Then, generate a beautiful SVG poster informed by what you learned.',
  '',
  'FINAL OUTPUT RULES:',
  '- Your FINAL message must be ONLY raw SVG markup. Nothing else.',
  '- SVG must be exactly 400x240 pixels (width="400" height="240").',
  '- Do NOT wrap in markdown code fences.',
  '- Do NOT include any explanation in your final message.',
  '- Final message starts with <svg and ends with </svg>.',
].join('\n');

export const POSTER_ALLOWED_TOOLS = ['Read', 'Glob', 'Grep'];

export function buildPosterPrompt(name: string, language: string, markers: string): string {
  const parts = [
    `Explore the project directory to understand what "${name}" is about.`,
    'Read the README.md if it exists, and look for any logos, icons, or branding.',
    `Then generate a minimal, elegant SVG poster for this ${language} project.`,
    '400x240px, dark background, subtle geometric elements, project name prominent.',
    'Modern technical style, like a Steam game library card.',
    'Let the project\'s purpose and personality inform the visual design.',
  ];
  if (markers) {
    parts.push(`Tech detected: ${markers}`);
  }
  return parts.join('\n');
}
