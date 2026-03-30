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
  'You are a graphic designer generating SVG poster artwork.',
  'The user will describe what they want. You produce the SVG.',
  '',
  'RULES:',
  '- Output ONLY raw SVG markup. Nothing else.',
  '- SVG must be exactly 400x240 pixels (width="400" height="240").',
  '- Do NOT create files, use tools, or write to disk.',
  '- Do NOT wrap in markdown code fences.',
  '- Do NOT include any explanation before or after the SVG.',
  '- Your entire response starts with <svg and ends with </svg>.',
].join('\n');

export function buildPosterPrompt(name: string, language: string, markers: string): string {
  const parts = [
    `Generate a minimal, elegant SVG poster for a ${language} project called "${name}".`,
    '400x240px, dark background, subtle geometric elements, project name prominent.',
    'Modern technical style, like a Steam game library card.',
  ];
  if (markers) {
    parts.push(`Tech: ${markers}`);
  }
  return parts.join('\n');
}
