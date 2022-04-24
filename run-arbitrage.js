require('dotenv').config();
const Web3 = require('web3');

const abis = require('./abis');
const addresses = require('./addresses');

const web3 = new Web3(
  new Web3.providers.WebsocketProvider(process.env.RPC_URL)
);

const kyber = new web3.eth.Contract(abis.kyber.kyberNetworkProxy, addresses.mainnet.kyber.kyberNetworkProxy);


/* USD price of ETH */
const RECENT_ETH_PRICE = 2934; 

const ETH_AMOUNT = 100;
const AMOUNT_ETH_WEI = web3.utils.toWei(ETH_AMOUNT.toString());
const AMOUNT_DAI_WEI = web3.utils.toWei((ETH_AMOUNT * RECENT_ETH_PRICE).toString());

/* subscribing to notification whenever a new block is mined */
/* just interested in block headers because don't need the block data  */
web3.eth.subscribe('newBlockHeaders')
  .on('data', async block => {
    console.log(`new block received | block # ${block.number}`);
    const kyberResults = await Promise.all([
      /* rates when selling dai to buy ether */
      kyber.methods.getExpectedRate(addresses.mainnet.tokens.dai, '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', AMOUNT_DAI_WEI).call(),
      /* rates when selling ehter to buy dai */
      kyber.methods.getExpectedRate('0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', addresses.mainnet.tokens.dai, AMOUNT_ETH_WEI).call()
    ]);

    /* calculations with referece to dai */
    /* to sell dai, we will be BUYing eth, rate should be 1/rate to get the value in dai */
    const kyberRates = {
      buy: parseFloat(1 / (kyberResults[0].expectedRate / (10 ** 18))),
      sell: parseFloat(kyberResults[1].expectedRate / (10 ** 18))
    };

    console.log('Kyber ETH/DAI');
    console.log(kyberRates);
  })
  .on('error', error => {
    console.log(error);
  });