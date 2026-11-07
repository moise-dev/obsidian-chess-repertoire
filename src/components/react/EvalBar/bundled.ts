// Stockfish 10's loader as text and its wasm as bytes, both inlined into
// main.js by esbuild: a store install gets main.js, manifest.json and
// styles.css and nothing else. Kept to this file because Prettier 2 cannot
// parse import attributes, and .prettierignore names it alone.
import engineSource from 'stockfish/src/stockfish.js' with { type: 'text' };
import engineWasm from 'stockfish/src/stockfish.wasm' with { type: 'bytes' };

export { engineSource, engineWasm };
