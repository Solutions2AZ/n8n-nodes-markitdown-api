const fs = require('fs');
const path = require('path');

const sourceRoot = path.join(__dirname, '..', 'nodes');
const targetRoot = path.join(__dirname, '..', 'dist', 'nodes');

function copySvgFiles(sourceDir, targetDir) {
	for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
		const sourcePath = path.join(sourceDir, entry.name);
		const targetPath = path.join(targetDir, entry.name);

		if (entry.isDirectory()) {
			copySvgFiles(sourcePath, targetPath);
			continue;
		}

		if (entry.isFile() && entry.name.endsWith('.svg')) {
			fs.mkdirSync(targetDir, { recursive: true });
			fs.copyFileSync(sourcePath, targetPath);
		}
	}
}

copySvgFiles(sourceRoot, targetRoot);
