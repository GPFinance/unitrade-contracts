import { config } from "dotenv"
import "@nomiclabs/hardhat-waffle"
import { HardhatUserConfig } from "hardhat/types/config"

config()

export default {
  solidity: {
    version: "0.6.12",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {
      forking: {
        url: `https://eth-mainnet.alchemyapi.io/v2/${process.env.ALCHEMY_API_KEY}`,
        blockNumber: 11543930,
      },
    },
  },
} as HardhatUserConfig
