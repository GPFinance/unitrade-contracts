import { expect, use } from "chai"
import { ethers } from "hardhat"
import { BigNumber, Contract, Signer } from "ethers"
// import { deployContract, deployMockContract, MockProvider, solidity } from "ethereum-waffle"

import { getUniswapPairAddress } from "./helpers"
import { parseEther } from "ethers/lib/utils"

// const UNISWAP_V2_ROUTER_ABI = artifacts.require("IUniswapV2Router02").abi
// const UNISWAP_V2_PAIR_ABI = artifacts.require("IUniswapV2Pair").abi

const UNISWAP_V2_FACTORY_ADDRESS = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f"
const UNISWAP_V2_ROUTER_ADDRESS = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"
const ROCKET_V2_ADDRESS = "0x78571acCAf24052795F98B11F093b488a2d9EAA4"
const USDC_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
const DAI_ADDRESS = "0x6B175474E89094C44Da98b954EedeAC495271d0F"
// TODO: Use local code instead of forking
const UNITRADE_ORDER_BOOK_ADDRESS = "0xC1bF1B4929DA9303773eCEa5E251fDEc22cC6828"

const { getContractFactory, getContractAt, provider, utils } = ethers
const { getAddress } = utils
// use(solidity)

describe.only("UniTradeMarketOrders", () => {
  // const provider = new MockProvider({
  //   ganacheOptions: {
  //     time: new Date(1700000000 * 1000),
  //     gasLimit: 12500000,
  //   },
  // })
  let wallet: Signer
  let uniswapV2Factory: Contract
  let uniswapV2Router: Contract
  let mockIncinerator: Contract
  let mockStaker: Contract
  let weth: Contract
  let dai: Contract
  let usdc: Contract
  let rocket: Contract
  let marketOrders: Contract
  const orderType = {
    TokensForTokens: 0,
    EthForTokens: 1,
    TokensForEth: 2,
    Invalid: 3,
  }
  const deadline = ethers.constants.MaxUint256

  beforeEach("setup contracts", async () => {
    ;[wallet] = await ethers.getSigners()

    weth = await getContractAt("IERC20", WETH_ADDRESS, wallet)
    dai = await getContractAt("IERC20", DAI_ADDRESS, wallet)
    usdc = await getContractAt("IERC20", USDC_ADDRESS, wallet)
    rocket = await getContractAt("IERC20", ROCKET_V2_ADDRESS, wallet)
    uniswapV2Factory = await getContractAt("IUniswapV2Factory", UNISWAP_V2_FACTORY_ADDRESS, wallet)
    uniswapV2Router = await getContractAt("IUniswapV2Router02", UNISWAP_V2_ROUTER_ADDRESS, wallet)

    const UniTradeMarketOrders = await getContractFactory("UniTradeMarketOrders", wallet)
    marketOrders = await UniTradeMarketOrders.deploy(UNITRADE_ORDER_BOOK_ADDRESS)
    await marketOrders.deployed()
  })

  describe("ETH->TOKEN - standard token", () => {
    let orderParams: any[]

    beforeEach(async () => {
      orderParams = [orderType.EthForTokens, weth.address, dai.address, parseEther("1"), parseEther("730")]
    })

    it("should return swap amounts", async () => {
      const [, , , amountInOffered] = orderParams
      const [inAmount, outAmount] = await marketOrders.callStatic.executeOrder(...orderParams, { value: amountInOffered })
      expect(inAmount).to.equal(parseEther("0.998"))
      expect(outAmount).to.equal("732697527087458939690")
    })

    it("should execute an order", async () => {
      // given
      const [, tokenIn, tokenOut, amountInOffered, amountOutExpected] = orderParams

      // when
      const tx = marketOrders.executeOrder(...orderParams, { value: amountInOffered })

      // then
      await expect(tx)
        .to.emit(marketOrders, "OrderExecuted")
        .withArgs(await wallet.getAddress(), tokenIn, tokenOut, [parseEther("0.998"), "732697527087458939690"], 2000000000000000)

      // expect(await provider.getBalance(mockIncinerator.address)).to.equal(6)
      // expect(await provider.getBalance(mockStaker.address)).to.equal(4)
      expect(await provider.getBalance(marketOrders.address)).to.equal("2000000000000000")
    })

    it("should stake and burn", async () => {
      // given
      const [, , , amountInOffered] = orderParams
      expect(await provider.getBalance(marketOrders.address)).to.equal(0)
      await marketOrders.executeOrder(...orderParams, { value: amountInOffered })
      expect(await provider.getBalance(marketOrders.address)).to.equal("2000000000000000")

      // when
      await marketOrders.stakeAndBurn()

      // then
      expect(await provider.getBalance(marketOrders.address)).to.equal(0)
    })
  })

  describe("ETH->TOKEN - token with fee", () => {
    let orderParams: any[]

    beforeEach(async () => {
      orderParams = [orderType.EthForTokens, weth.address, rocket.address, 1000, 200]
      const [, tokenIn, tokenOut, amountInOffered, amountOutExpected] = orderParams

      const pairAddress = getUniswapPairAddress(tokenIn, tokenOut)

      await uniswapV2Factory.mock.getPair.withArgs(tokenIn, tokenOut).returns(pairAddress)

      await uniswapV2Router.mock.swapExactETHForTokensSupportingFeeOnTransferTokens
        .withArgs(amountOutExpected, [tokenIn, tokenOut], await wallet.getAddress(), deadline)
        .returns()
    })

    it("should return swap amounts", async () => {
      const response = await marketOrders.connect(wallet).callStatic.executeOrder(...orderParams, { value: orderParams[3] })
      expect(response[0]).to.equal(990)
      // Note: Receiving 0 instead of 200 because mock contract doesn't transfer funds
      expect(response[1]).to.equal(0 /* 198 */)
    })

    it("should execute an order", async () => {
      // given
      const [, tokenIn, tokenOut, amountInOffered, amountOutExpected] = orderParams

      // when
      const tx = marketOrders.connect(wallet).executeOrder(...orderParams, { value: amountInOffered })

      // then
      await expect(tx)
        .to.emit(marketOrders, "OrderExecuted")
        // Note: Receiving 0 instead of 200 because mock contract doesn't transfer funds
        .withArgs(await wallet.getAddress(), tokenIn, tokenOut, [990, 0 /* 198 */], 10)

      expect(await provider.getBalance(mockIncinerator.address)).to.equal(6)
      expect(await provider.getBalance(mockStaker.address)).to.equal(4)
      expect(await provider.getBalance(marketOrders.address)).to.equal(0)
    })
  })

  describe.only("TOKEN->ETH - standard token", () => {
    let orderParams: any[]

    beforeEach(async () => {
      orderParams = [orderType.TokensForEth, dai.address, weth.address, parseEther("1000"), parseEther("1.35")]
      const [, , , amountInOffered] = orderParams

      // getting some dai
      await uniswapV2Router.swapExactETHForTokens(0, [WETH_ADDRESS, DAI_ADDRESS], await wallet.getAddress(), 999999999999, {
        value: parseEther("10"),
      })

      await dai.approve(marketOrders.address, amountInOffered)
    })

    it("should return swap amounts", async () => {
      const [inAmount, outAmount] = await marketOrders.connect(wallet).callStatic.executeOrder(...orderParams)
      const [, , , amountInOffered] = orderParams
      expect(inAmount).to.equal(amountInOffered)
      expect(outAmount).to.equal("1354186354753848361")
    })

    it("should execute an order", async () => {
      // given
      const [, tokenIn, tokenOut, amountInOffered] = orderParams

      // when
      const tx = marketOrders.connect(wallet).executeOrder(...orderParams)

      // then
      const expectedFee = "2708954382807601"
      await expect(tx)
        .to.emit(marketOrders, "OrderExecuted")
        .withArgs(await wallet.getAddress(), tokenIn, tokenOut, [amountInOffered, "1354477191403800867"], expectedFee)

      // expect(await provider.getBalance(mockIncinerator.address)).to.equal(12)
      // expect(await provider.getBalance(mockStaker.address)).to.equal(8)
      expect(await provider.getBalance(marketOrders.address)).to.equal(expectedFee)
    })

    it("should stake and burn", async () => {
      // given
      const [, , , amountInOffered] = orderParams
      expect(await provider.getBalance(marketOrders.address)).to.equal(0)
      await marketOrders.executeOrder(...orderParams, { value: amountInOffered })
      expect(await provider.getBalance(marketOrders.address)).to.equal("1000002709457082929248")

      // when
      await marketOrders.stakeAndBurn()

      // then
      // expect(await provider.getBalance(marketOrders.address)).to.equal("1000002709457082929248")
      expect(await provider.getBalance(marketOrders.address)).to.equal(0)
    })
  })

  describe("TOKEN->ETH - token with fee", () => {
    let orderParams: any[]

    beforeEach(async () => {
      orderParams = [orderType.TokensForEth, rocket.address, weth.address, 1000, 2000]
      const [, tokenIn, tokenOut, amountInOffered, amountOutExpected] = orderParams

      const pairAddress = getUniswapPairAddress(tokenIn, tokenOut)
      await uniswapV2Factory.mock.getPair.withArgs(tokenIn, tokenOut).returns(pairAddress)

      await rocket.approve(marketOrders.address, amountInOffered)

      await uniswapV2Router.mock.swapExactTokensForETHSupportingFeeOnTransferTokens
        .withArgs(990, amountOutExpected, [tokenIn, tokenOut], marketOrders.address, deadline)
        .returns()
    })

    it("should return swap amounts", async () => {
      const response = await marketOrders.connect(wallet).callStatic.executeOrder(...orderParams)
      expect(response[0]).to.equal(990)
      // Note: Receiving 0 instead because mock contract doesn't transfer funds
      expect(response[1]).to.equal(0 /* 2000 */)
    })

    it("should execute an order", async () => {
      // given
      const [, tokenIn, tokenOut, amountInOffered, amountOutExpected] = orderParams

      // when
      const tx = marketOrders.connect(wallet).executeOrder(...orderParams)

      // then
      await expect(tx)
        .to.emit(marketOrders, "OrderExecuted")
        // Note: Receiving 0 instead because mock contract doesn't transfer funds
        .withArgs(await wallet.getAddress(), tokenIn, tokenOut, [990, 0 /* 2000 */], 0 /*10*/)

      // Note: Receiving 0 instead because mock contract doesn't transfer funds
      expect(await provider.getBalance(mockIncinerator.address)).to.equal(0 /*12*/)

      // Note: Receiving 0 instead because mock contract doesn't transfer funds
      expect(await provider.getBalance(mockStaker.address)).to.equal(0 /*8*/)

      expect(await provider.getBalance(marketOrders.address)).to.equal(0)
    })
  })

  describe("TOKEN->TOKEN - standard token", () => {
    let orderParams: any[]

    beforeEach(async () => {
      orderParams = [orderType.TokensForTokens, dai.address, usdc.address, 1000, 2000]
      const [, tokenIn, tokenOut, amountInOffered, amountOutExpected] = orderParams

      const pairAddress = getUniswapPairAddress(tokenIn, weth.address)
      await uniswapV2Factory.mock.getPair.withArgs(tokenIn, weth.address).returns(pairAddress)

      await dai.approve(marketOrders.address, amountInOffered)

      await uniswapV2Router.mock.swapExactTokensForTokensSupportingFeeOnTransferTokens
        .withArgs(990, amountOutExpected, [tokenIn, tokenOut], await wallet.getAddress(), deadline)
        .returns()

      await uniswapV2Router.mock.swapExactTokensForETHSupportingFeeOnTransferTokens
        .withArgs(10, 0, [tokenIn, weth.address], marketOrders.address, deadline)
        .returns()
    })

    it("should return swap amounts", async () => {
      const response = await marketOrders.connect(wallet).callStatic.executeOrder(...orderParams)
      expect(response[0]).to.equal(990)
      // Note: Receiving 0 instead because mock contract doesn't transfer funds
      expect(response[1]).to.equal(0 /* 2000 */)
    })

    it("should execute an order", async () => {
      // given
      const [, tokenIn, tokenOut, amountInOffered, amountOutExpected] = orderParams

      // when
      const tx = marketOrders.connect(wallet).executeOrder(...orderParams)

      // then
      await expect(tx)
        .to.emit(marketOrders, "OrderExecuted")
        // Note: Receiving 0 instead because mock contract doesn't transfer funds
        .withArgs(await wallet.getAddress(), tokenIn, tokenOut, [990, 0 /* 200 */], 0 /*10*/)

      // Note: Receiving 0 instead because mock contract doesn't transfer funds
      expect(await provider.getBalance(mockIncinerator.address)).to.equal(0 /*12*/)

      // Note: Receiving 0 instead because mock contract doesn't transfer funds
      expect(await provider.getBalance(mockStaker.address)).to.equal(0 /*8*/)

      expect(await provider.getBalance(marketOrders.address)).to.equal(0)
    })
  })

  describe("TOKEN->TOKEN - token with fee", () => {
    let orderParams: any[]

    beforeEach(async () => {
      orderParams = [orderType.TokensForTokens, rocket.address, usdc.address, 1000, 2000]
      const [, tokenIn, tokenOut, amountInOffered, amountOutExpected] = orderParams

      const pairAddress = getUniswapPairAddress(tokenIn, weth.address)
      await uniswapV2Factory.mock.getPair.withArgs(tokenIn, weth.address).returns(pairAddress)

      await rocket.approve(marketOrders.address, amountInOffered)

      await uniswapV2Router.mock.swapExactTokensForTokensSupportingFeeOnTransferTokens
        .withArgs(981, amountOutExpected, [tokenIn, tokenOut], await wallet.getAddress(), deadline)
        .returns()

      await uniswapV2Router.mock.swapExactTokensForETHSupportingFeeOnTransferTokens
        .withArgs(9, 0, [tokenIn, weth.address], marketOrders.address, deadline)
        .returns()
    })

    it("should return swap amounts", async () => {
      const response = await marketOrders.connect(wallet).callStatic.executeOrder(...orderParams)
      expect(response[0]).to.equal(981)
      // Note: Receiving 0 instead because mock contract doesn't transfer funds
      expect(response[1]).to.equal(0 /* 2000 */)
    })

    it("should execute an order", async () => {
      // given
      const [, tokenIn, tokenOut, amountInOffered, amountOutExpected] = orderParams

      // when
      const tx = marketOrders.connect(wallet).executeOrder(...orderParams)

      // then
      await expect(tx)
        .to.emit(marketOrders, "OrderExecuted")
        // Note: Receiving 0 instead because mock contract doesn't transfer funds
        .withArgs(await wallet.getAddress(), tokenIn, tokenOut, [981, 0 /* 200 */], 0 /*10*/)

      // Note: Receiving 0 instead because mock contract doesn't transfer funds
      expect(await provider.getBalance(mockIncinerator.address)).to.equal(0 /*12*/)

      // Note: Receiving 0 instead because mock contract doesn't transfer funds
      expect(await provider.getBalance(mockStaker.address)).to.equal(0 /*8*/)

      expect(await provider.getBalance(marketOrders.address)).to.equal(0)
    })
  })
})
