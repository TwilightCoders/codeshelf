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
