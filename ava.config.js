module.exports = {
  files: ["src/**/*.test.ts"],
  extensions: ["ts"],
  require: ["esbuild-register"],
  environmentVariables: {
    IS_TESTING_AVA_POSTGRES: "true",
  },
}
