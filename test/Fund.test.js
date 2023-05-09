const assert = require('assert');
const hre = require("hardhat");
const Web3 = require("web3");
const web3 = new Web3(hre.network.provider); // hre.network.provider is an EIP1193-compatible provider.
const ERC20abi = require('erc-20-abi');

const compiledFund = require('../artifacts/ethereum/contracts/Fund.sol/Fund.json');
const compiledUSDC = require('../artifacts/ethereum/contracts/USDC.sol/FiatTokenV2_1.json');
const compiledFactory = require('../artifacts/ethereum/contracts/TakaturnFactory.sol/TakaturnFactory.json');
const compiledCollateral = require('../artifacts/ethereum/contracts/Collateral.sol/Collateral.json');

const { eventNames } = require('process');

let accounts = [];
let fund;
let usdc;
let collateral;

const USDC_ADDRESS = '0x0fa8781a83e46826621b3bc094ea2a0212e71b23';

const totalParticipants = 12;
const cycleTime = 60;
const contributionAmount = 100;
const contributionPeriod = 20;
const collateralFundingPeriod = 604800;
const collateralAmount = 60;

describe('Takaturn Fund & USDC dummy contract', () => {
    beforeEach(async () => {

        accounts = await web3.eth.getAccounts();
    
        // accounts used:
        // 0 - 11: participants
        // 12: fund contract owner
        // 13: usdc owner, blacklister, pauser
        // 14: usdc masterMinter
        // 15: usdc regular minter
        // 16: usdc lost and found
    
        //usdc = new web3.eth.Contract(ERC20abi, USDC_ADDRESS); //USDC Polygon Testnet
        usdc = await new web3.eth.Contract(compiledUSDC.abi)
        .deploy({ data: compiledUSDC.bytecode})
        .send({ from: accounts[13], gas: "14000000" });
    
        await usdc.methods.initialize("USD Coin", "USDC", "USD", 6, accounts[14], accounts[13], accounts[13], accounts[13]).send({
            from: accounts[13]
        });
    
        await usdc.methods.configureMinter(accounts[15], 10000000000000).send({
            from: accounts[14]
        });
    
        await usdc.methods.initializeV2("USD Coin").send({
            from: accounts[13]
        });  
    
        await usdc.methods.initializeV2_1(accounts[16]).send({
            from: accounts[13]
        });
    
        participants = [];
    
        for (let i = 0; i < totalParticipants; i++) {
            participants.push(accounts[i]);
        }
    
        factory = await new web3.eth.Contract(compiledFactory.abi)
        .deploy({ data: compiledFactory.bytecode })
        .send({ from: accounts[12], gas: "14000000" });
    
        // create collateral contract to provide as input
        // create collateral contract to provide as input
        await factory.methods.createCollateral(totalParticipants, 
            cycleTime, 
            contributionAmount, 
            contributionPeriod, 
            collateralAmount,
            web3.utils.toWei("3", "ether"),
            usdc.options.address,
            "0xD4a33860578De61DBAbDc8BFdb98FD742fA7028e"
        ).send({ from: accounts[12], gas: "10000000" });
    
        [collateralAddress] = await factory.methods.getDeployedCollaterals().call();
        collateral = await new web3.eth.Contract(compiledCollateral.abi, collateralAddress);

        for (let i = 0; i < totalParticipants; i++) {
            await collateral.methods.depositCollateral().send({
                value: web3.utils.toWei("3", "ether"), 
                from: accounts[i]
            });
        }

        await collateral.methods.initiateFundContract().send({ from: accounts[12], gas: "10000000" });

        let newFundAddress = await collateral.methods.fundContract().call();
        fund = await new web3.eth.Contract(compiledFund.abi, newFundAddress); 
    
        for (let i = 0; i < totalParticipants; i++) {
            await usdc.methods.mint(accounts[i], contributionAmount * 10 ** 8 * totalParticipants).send({
                from: accounts[15]
            });
        }
    
    });

    it('deploys an USDC instance', () => {
        assert.ok(usdc.options.address);
    });

    it('upgrades the USDC instance', async () => {
        assert.ok(await usdc.methods.version().call() == "2");
    });

    it('gives some USDC to the participants', async () => {
        balance = await usdc.methods.balanceOf(accounts[0]).call();
        //console.log(balance)
        assert.ok(balance > 0);
    });

    it('deploys a fund instance', () => {
        assert.ok(fund.options.address); 
    });
    
    it('adds participants', async () => {
        let lastAddress = await fund.methods.beneficiariesOrder(totalParticipants - 1).call();
        assert.ok(lastAddress == accounts[totalParticipants - 1]);
    });
/*
    it('shuffles participants', async () => {
        let firstAddress = await fund.methods.beneficiariesOrder(0).call();
        let lastAddress = await fund.methods.beneficiariesOrder(totalParticipants - 1).call();
        assert.ok(firstAddress != accounts[0] || lastAddress != accounts[totalParticipants - 1]);
    });*/

    it('starts a new cycle', async () => {
        let currentCycle = await fund.methods.currentCycle().call();
        assert.ok(currentCycle == 1);
    });

    it('cannot start a new cycle while an existing cycle is going', async () => {
        try {
            await fund.methods.startNewCycle().send({
                from: accounts[12]
            });
        }
        catch (e) {}

        let currentCycle = await fund.methods.currentCycle().call();
        assert.ok(currentCycle == 1);
    });

    it('enables participants to pay in USDC and the payments are succesful', async () => {

        for (let i = 0; i < totalParticipants; i++) {
            await usdc.methods.approve(fund.options.address, contributionAmount * 10 ** 6).send({
                from: accounts[i]
            });

    
            await fund.methods.payContribution().send({
                from: accounts[i]
            });
        }

        assert.ok(await fund.methods.paidThisCycle(accounts[0]).call() && await usdc.methods.balanceOf(fund.options.address).call() == 1200 * 10 ** 6);
    });

    
});