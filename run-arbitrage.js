require('dotenv').config();
const Web3 = require('web3');
const { ChainId, Token, TokenAmount, Pair, Fetcher, WETH } = require('@uniswap/sdk');

const abis = require('./abis');
const addresses = require('./addresses');
const Flashloan = require('./build/contracts/Flashloan.json');

const web3 = new Web3(
  new Web3.providers.WebsocketProvider(process.env.RPC_URL)
);

const { address: admin } = web3.eth.accounts.wallet.add(process.env.PRIVATE_KEY);

const kyber = new web3.eth.Contract(abis.kyber.kyberNetworkProxy, addresses.mainnet.kyber.kyberNetworkProxy);


/* USD price of ETH */
const RECENT_ETH_PRICE = 2934; 

/* hard coding gas cost till smart contract is deployed */
const gasCost = 200000;

const ETH_AMOUNT = 100;
const AMOUNT_ETH_WEI = web3.utils.toWei(ETH_AMOUNT.toString());
const AMOUNT_DAI_WEI = web3.utils.toWei((ETH_AMOUNT * RECENT_ETH_PRICE).toString());
const DIRECTION = {
  KYBER_TO_UNISWAP: 0,
  UNISWAP_TO_KYBER: 1
};

const DAI = new Token(ChainId.MAINNET, '0x6B175474E89094C44Da98b954EedeAC495271d0F', 18)

const init = async () => {
  const networkId = await web3.eth.net.getId();
  const flashloan = await web3.eth.Contract(Flashloan.abi, Flashloan.networks[networkId].address);
  
  const [dai, weth] = await Promise.all(
    [addresses.mainnet.tokens.dai, addresses.mainnet.tokens.weth].map(address => Fetcher.fetchTokenData(ChainId.MAINNET, address))
  );

  const daiWeth = await Fetcher.fetchPairData(DAI, WETH[DAI.chainId]);
  // const daiWeth = await Pair.fetchData(dai, weth);

  
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

      const uniswapResults = await Promise.all([
        daiWeth.getOutputAmount(new TokenAmount(dai, AMOUNT_DAI_WEI)),
        daiWeth.getOutputAmount(new TokenAmount(weth, AMOUNT_ETH_WEI)),
      ]);

      const uniswapRates = {
        /* for the buy price, divide the number of DAI provided as input by the number of ETH uniswap returned */
        /* and multiply the returned value which is in ethers with 10 ** 18 to get correct precision */
        buy: parseFloat(AMOUNT_DAI_WEI / (uniswapResults[0][0].toExact() * 10 ** 18)),
        
        /* for the sell price, divide the uniswap result which is amount of DAI we get if we give ether as input */
        sell: parseFloat(uniswapResults[1][0].toExact() / ETH_AMOUNT)
      };

      console.log('Uniswap ETH/DAI');
      console.log(uniswapRates);

      const [tx1, tx2] = Object.keys(DIRECTION).map(direction => flashloan.methods.initiateFlashloan(
        addresses.mainnet.dydx.solo,
        addresses.mainnet.tokens.dai,
        AMOUNT_DAI_WEI,
        direction
      ));

      const [gasPrice, gasCost1, gasCost2] = await Promise.all([
        /* Current gas price in wei */
        web3.eth.getGasPrice(),
        tx1.estimateGas({ from: admin }),
        tx2.estimateGas({ from: admin })
      ]);
      
      /* estimate total gas cost for this transaction */
      const txCost1 = parseInt(gasCost1) * parseInt(gasPrice);
      const txCost2 = parseInt(gasCost2) * parseInt(gasPrice);

      /* current ETH price is average buy and sell price */
      const currentEthPrice = (uniswapRates.buy + uniswapRates.sell) / 2;

      const profitInUSDBuyEthOnKyberSellEthOnUniswap = (parseInt(AMOUNT_ETH_WEI) / 10 ** 18) * (uniswapRates.sell - kyberRates.buy) - (txCost1 / 10 ** 18) * currentEthPrice;
      const profitInUSDBuyEthOnUniswapSellEthOnKyber = (parseInt(AMOUNT_ETH_WEI) / 10 ** 18) * (kyberRates.sell - uniswapRates.buy) - (txCost2 / 10 ** 18) * currentEthPrice;

      if (profitInUSDBuyEthOnKyberSellEthOnUniswap > 0) {
        console.log('Arb opportunity found!');
        console.log(`Buy ETH on Kyber at ${kyberRates.buy} dai`);
        console.log(`Sell ETH on Uniswap at ${uniswapRates.sell} dai`);
        console.log(`Expected profit: ${profitInUSDBuyEthOnKyberSellEthOnUniswap} dai`);

        /* Execute arb Kyber <=> Uniswap */ 
        const data = tx1.encodeABI();
        const txData = {
          from: admin,
          to: flashloan.options.address,
          data,
          gas: gasCost1,
          gasPrice
        };
        const receipt = await web3.eth.sendTransaction(txData);
        console.log(`Transaction hash: ${receipt.transactionHash}`);

      } else if (profitInUSDBuyEthOnUniswapSellEthOnKyber > 0) {
        console.log('Arb opportunity found!');
        console.log(`Buy ETH from Uniswap at ${uniswapRates.buy} dai`);
        console.log(`Sell ETH from Kyber at ${kyberRates.sell} dai`);
        console.log(`Expected profit: ${profitInUSDBuyEthOnUniswapSellEthOnKyber} dai`);
        
        /* Execute arb Uniswap <=> Kyber */
        const data = tx2.encodeABI();
        const txData = {
          from: admin,
          to: flashloan.options.address,
          data,
          gas: gasCost2,
          gasPrice
        };
        const receipt = await web3.eth.sendTransaction(txData);
        console.log(`Transaction hash: ${receipt.transactionHash}`);
      }
      
    })
    .on('error', error => {
      console.log(error);
    });

};

init();