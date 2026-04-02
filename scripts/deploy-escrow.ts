// scripts/deploy-escrow.ts
// Deploy AgentEscrow.sol to Base Sepolia (testnet) or Base Mainnet
//
// Setup:
//   npm install --save-dev hardhat @nomicfoundation/hardhat-ethers ethers @openzeppelin/contracts
//   npx hardhat compile
//
// Deploy testnet:
//   npx hardhat run scripts/deploy-escrow.ts --network base-sepolia
//
// Deploy mainnet:
//   npx hardhat run scripts/deploy-escrow.ts --network base

import { ethers } from 'hardhat'

async function main() {
  const [deployer] = await ethers.getSigners()
  console.log('Deploying with account:', deployer.address)

  const balance = await ethers.provider.getBalance(deployer.address)
  console.log('Account balance:', ethers.formatEther(balance), 'ETH\n')

  const network = await ethers.provider.getNetwork()
  const isTestnet = network.chainId === 84532n // Base Sepolia

  // USDC address per network
  const USDC = isTestnet
    ? '0x036CbD53842c5426634e7929541eC2318f3dCF7e'  // Base Sepolia USDC
    : '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'  // Base Mainnet USDC

  const VERIFIER = deployer.address // marketplace wallet = verifier initially

  console.log(`Network: ${isTestnet ? 'Base Sepolia (testnet)' : 'Base Mainnet'}`)
  console.log(`USDC:     ${USDC}`)
  console.log(`Verifier: ${VERIFIER}\n`)

  const EscrowFactory = await ethers.getContractFactory('AgentEscrow')
  const escrow = await EscrowFactory.deploy(USDC, VERIFIER)
  await escrow.waitForDeployment()

  const address = await escrow.getAddress()
  console.log('✅ AgentEscrow deployed to:', address)
  console.log(`\nExplorer: ${isTestnet
    ? `https://sepolia.basescan.org/address/${address}`
    : `https://basescan.org/address/${address}`
  }`)

  console.log('\n📋 Next steps:')
  console.log(`1. Add to .env.local:`)
  console.log(`   ESCROW_CONTRACT_ADDRESS=${address}`)
  console.log(`2. Verify on Basescan:`)
  console.log(`   npx hardhat verify --network ${isTestnet ? 'base-sepolia' : 'base'} ${address} ${USDC} ${VERIFIER}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
