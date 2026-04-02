import { HardhatUserConfig } from 'hardhat/config'
import '@nomicfoundation/hardhat-ethers'
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.20',
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    'base-sepolia': {
      url: `https://base-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
      accounts: [process.env.MARKETPLACE_WALLET_PRIVATE_KEY!],
      chainId: 84532,
    },
    base: {
      url: `https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
      accounts: [process.env.MARKETPLACE_WALLET_PRIVATE_KEY!],
      chainId: 8453,
    },
  },
  etherscan: {
    apiKey: {
      'base-sepolia': process.env.BASESCAN_API_KEY ?? '',
      base:           process.env.BASESCAN_API_KEY ?? '',
    },
    customChains: [
      {
        network: 'base-sepolia',
        chainId: 84532,
        urls: {
          apiURL:    'https://api-sepolia.basescan.org/api',
          browserURL:'https://sepolia.basescan.org',
        },
      },
      {
        network: 'base',
        chainId: 8453,
        urls: {
          apiURL:    'https://api.basescan.org/api',
          browserURL:'https://basescan.org',
        },
      },
    ],
  },
}

export default config
