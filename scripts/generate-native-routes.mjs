import { Generator, getConfig } from '@tanstack/router-generator';
const root = process.cwd();
const config = getConfig({ target: 'react', routesDirectory: './src/routes', generatedRouteTree: './src/routeTree.gen.ts' }, root);
await new Generator({ config, root }).run();
