module.exports = async function extract(source) {
  throw new Error(`extract-zip is disabled in vivePDF (asked to unpack ${source}); the e2e run never downloads browsers`);
};
