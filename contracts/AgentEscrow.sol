// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// contracts/AgentEscrow.sol
// Deploy on Base Sepolia for testing, Base mainnet for production
//
// npx hardhat run scripts/deploy.ts --network base-sepolia
// Verify: npx hardhat verify --network base-sepolia DEPLOYED_ADDRESS

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract AgentEscrow is Ownable, ReentrancyGuard {
    // ── Base Mainnet USDC: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
    // ── Base Sepolia USDC: 0x036CbD53842c5426634e7929541eC2318f3dCF7e
    IERC20 public immutable usdc;

    // Take rate: 50 = 0.5%, 500 = 5% (basis points out of 10000)
    uint256 public feeBps = 500; // 5% default
    address public feeRecipient;
    address public verifier;     // off-chain verifier (your Next.js server wallet)

    enum JobStatus { Open, InProgress, Submitted, Completed, Disputed, Cancelled }

    struct Job {
        address requester;
        address agentWallet;
        uint256 amount;         // USDC in 6-decimal units
        bytes32 jobHash;        // keccak256 of job params (for integrity)
        JobStatus status;
        uint256 createdAt;
        uint256 deadline;
    }

    mapping(bytes32 => Job) public jobs;

    // ── Events ────────────────────────────────────────────────────────────
    event JobLocked(bytes32 indexed jobId, address indexed requester, address indexed agentWallet, uint256 amount);
    event JobCompleted(bytes32 indexed jobId, address indexed agentWallet, uint256 agentAmount, uint256 fee);
    event JobCancelled(bytes32 indexed jobId, address indexed requester, uint256 refund);
    event JobDisputed(bytes32 indexed jobId, address indexed disputedBy);
    event DisputeResolved(bytes32 indexed jobId, bool agentWon, uint256 agentAmount, uint256 requesterRefund);

    // ── Constructor ───────────────────────────────────────────────────────
    constructor(address _usdc, address _verifier) Ownable(msg.sender) {
        usdc = IERC20(_usdc);
        verifier = _verifier;
        feeRecipient = msg.sender;
    }

    // ── Lock funds when a job is matched ─────────────────────────────────
    function lockFunds(
        bytes32 jobId,
        address agentWallet,
        uint256 amount,
        bytes32 jobHash,
        uint256 deadlineSeconds
    ) external nonReentrant {
        require(jobs[jobId].requester == address(0), "Job already exists");
        require(agentWallet != address(0), "Invalid agent wallet");
        require(amount > 0, "Amount must be > 0");

        // Transfer USDC from requester to this contract
        bool ok = usdc.transferFrom(msg.sender, address(this), amount);
        require(ok, "USDC transfer failed");

        jobs[jobId] = Job({
            requester: msg.sender,
            agentWallet: agentWallet,
            amount: amount,
            jobHash: jobHash,
            status: JobStatus.InProgress,
            createdAt: block.timestamp,
            deadline: block.timestamp + deadlineSeconds
        });

        emit JobLocked(jobId, msg.sender, agentWallet, amount);
    }

    // ── Release payment to agent (called by verifier) ─────────────────────
    function release(bytes32 jobId) external nonReentrant {
        require(msg.sender == verifier || msg.sender == owner(), "Not authorized");
        Job storage job = jobs[jobId];
        require(job.status == JobStatus.InProgress || job.status == JobStatus.Submitted, "Invalid status");

        job.status = JobStatus.Completed;

        uint256 fee = (job.amount * feeBps) / 10000;
        uint256 agentAmount = job.amount - fee;

        if (fee > 0) usdc.transfer(feeRecipient, fee);
        usdc.transfer(job.agentWallet, agentAmount);

        emit JobCompleted(jobId, job.agentWallet, agentAmount, fee);
    }

    // ── Refund requester (job failed or cancelled) ─────────────────────────
    function refund(bytes32 jobId) external nonReentrant {
        Job storage job = jobs[jobId];
        require(
            msg.sender == verifier ||
            msg.sender == owner() ||
            (msg.sender == job.requester && block.timestamp > job.deadline),
            "Not authorized"
        );
        require(job.status == JobStatus.InProgress, "Invalid status");

        job.status = JobStatus.Cancelled;
        usdc.transfer(job.requester, job.amount);

        emit JobCancelled(jobId, job.requester, job.amount);
    }

    // ── Open dispute (either party) ────────────────────────────────────────
    function dispute(bytes32 jobId) external {
        Job storage job = jobs[jobId];
        require(
            msg.sender == job.requester || msg.sender == job.agentWallet,
            "Not a party to this job"
        );
        require(job.status == JobStatus.InProgress || job.status == JobStatus.Submitted, "Invalid status");

        job.status = JobStatus.Disputed;
        emit JobDisputed(jobId, msg.sender);
    }

    // ── Resolve dispute (owner/verifier) ──────────────────────────────────
    function resolveDispute(bytes32 jobId, bool agentWon) external onlyOwner nonReentrant {
        Job storage job = jobs[jobId];
        require(job.status == JobStatus.Disputed, "Not in dispute");

        job.status = JobStatus.Completed;

        if (agentWon) {
            uint256 fee = (job.amount * feeBps) / 10000;
            uint256 agentAmount = job.amount - fee;
            if (fee > 0) usdc.transfer(feeRecipient, fee);
            usdc.transfer(job.agentWallet, agentAmount);
            emit DisputeResolved(jobId, true, agentAmount, 0);
        } else {
            usdc.transfer(job.requester, job.amount);
            emit DisputeResolved(jobId, false, 0, job.amount);
        }
    }

    // ── Admin ─────────────────────────────────────────────────────────────
    function setFeeBps(uint256 _feeBps) external onlyOwner {
        require(_feeBps <= 1000, "Max 10%");
        feeBps = _feeBps;
    }

    function setVerifier(address _verifier) external onlyOwner {
        verifier = _verifier;
    }

    function setFeeRecipient(address _recipient) external onlyOwner {
        feeRecipient = _recipient;
    }

    function getJob(bytes32 jobId) external view returns (Job memory) {
        return jobs[jobId];
    }
}
