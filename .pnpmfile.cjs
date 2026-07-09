module.exports = {
  hooks: {
    readPackage(pkg) {
      if (pkg.name === 'simple-mind-map' && pkg.dependencies && pkg.dependencies.quill) {
        delete pkg.dependencies.quill;
      }
      return pkg;
    }
  }
};
