const Flashloan = artifacts.require("Flashloan");
const addresses = require('../addresses');

module.exports = function (deployer, _network, [beneficiary]) {
  deployer.deploy(
    Flashloan, 
    addresses.mainnet.kyber.kyberNetworkProxy, 
    addresses.mainnet.uniswap.router,
    addresses.mainnet.tokens.weth,
    addresses.mainnet.tokens.dai,
    beneficiary
  );
};