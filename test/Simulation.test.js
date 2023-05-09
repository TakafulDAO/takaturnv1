const assert = require('assert');
const hre = require("hardhat");
const Web3 = require("web3");
const web3 = new Web3(hre.network.provider); // hre.network.provider is an EIP1193-compatible provider.
const ERC20abi = require('erc-20-abi');
const path = require('path');
const ExcelJS = require("exceljs");
const fs = require("fs");

const compiledFund = require('../artifacts/ethereum/contracts/Fund_simulation.sol/Fund_sim.json');
const compiledFactory = require('../artifacts/ethereum/contracts/TakaturnFactory_simulation.sol/TakaturnFactory_sim.json');
const compiledCollateral = require('../artifacts/ethereum/contracts/Collateral_simulation.sol/Collateral_sim.json');

const { snapshotEach } = require('hardhat-helpers');
const { eventNames } = require('process');
const { randomInt } = require('crypto');

let accounts = [];
let fund;
let usdc;
let collateral;

const totalParticipants = 12;
const cycleTime = 60;
const contributionAmount = 5;
const contributionPeriod = 40;
const collateralFundingPeriod = 604800;
const collateralAmount = 60;

const locallyManipulatedBalance = 1000 * 10 ** 6;

const states = {
    0 : "InitializingFund",
    1 : "AcceptingContributions",
    2 : "ChoosingBeneficiary",
    3 : "CycleOngoing",
    4 : "FundClosed"
}

let currentCycle;
let currentState;

//global
const USDC_ADDRESS = "0x07865c6E87B9F70255377e024ace6630C1Eaa37F";
const USDC_SLOT = 9;

var claimedCollaterals = [];
var claimedEthBalances = [];
var gasLog = [];
var initialGasLog = [];
var addressLogTable = {};

async function appendGasLog(contract, calledBy, functionName, gasUsed) {
    
    for (let i = 0; i < totalParticipants; i++) {
        addressLogTable[accounts[i]] = "Participant %s", (i + 1);
    }
    addressLogTable[accounts[totalParticipants]] = "Owner";
    addressLogTable[factory.options.address] = "Factory";
    addressLogTable[collateral.options.address] = "Collateral";
    addressLogTable[fund.options.address] = "Fund";

    gasLog.push([contract, calledBy, functionName, gasUsed].join(";"))
}

async function makeExcelSheet(outPath) {
    let currentCycle = parseInt(await fund.methods.currentCycle().call());
    let startingParticipants = totalParticipants;
    let currentParticipants = parseInt(await fund.methods.totalParticipants().call());
    let contribution = contributionAmount;
    let closeFundReason = await fund.methods.closeFundReason().call();

    let beneficiariesOrder = [];

    for (let i = 0; i < totalParticipants; i++) {
        try {
            beneficiariesOrder.push(await fund.methods.beneficiariesOrder(i).call());
        } catch (e) {break;}
    }

    let chosenBeneficiary = await fund.methods.lastBeneficiary().call();
    let chosenBeneficiaryIndex;
    for (let i = 0; i < totalParticipants; i++) {
        if (chosenBeneficiary == participants[i]) {
            chosenBeneficiaryIndex = i;
            break;
        }
    }

    //console.log(["Chosen Beneficiary index: ", chosenBeneficiaryIndex].join(""));

    let paidThisCycle = [];
    let hasBeenBeneficiary = [];
    let defaulters = [];
    let expelledMembers = [];
    let isUnderCollaterized = [];
    let collateralAmounts = [];
    let collateralPayments = [];
    let balances = [];

    for (let i = 0; i < totalParticipants; i++) {
        let isDefaulter = await fund.methods.paidThisCycle(participants[i]).call() && await fund.methods.currentState().call() > 2;
        paidThisCycle.push(await fund.methods.paidThisCycle(participants[i]).call());
        hasBeenBeneficiary.push(await fund.methods.isBeneficiary(participants[i]).call());
        defaulters.push(isDefaulter);
        expelledMembers.push(!(await collateral.methods.isCollateralMember(participants[i]).call()));
        isUnderCollaterized.push(await collateral.methods.isUnderCollaterized(participants[i]).call());
        collateralAmounts.push(await collateral.methods.collateralMembersBank(participants[i]).call() / 10 ** 18);
        collateralPayments.push(await collateral.methods.collateralPaymentBank(participants[i]).call() / 10 ** 18);
        balances.push(claimedEthBalances[i] + await usdc.methods.balanceOf(participants[i]).call() * 1 + await fund.methods.beneficiariesPool(participants[i]).call() * 1 - locallyManipulatedBalance);
    }

    //console.log(collateralPayments);

    let totalPaidThisCycle = 0;
    let totalDefaulted = 0;
    let totalExpelled = 0;
    for (let i = 0; i < totalParticipants; i++) {
        if (paidThisCycle[i]) {
            //console.log("Paid this cycle");
            totalPaidThisCycle++;
        }
        if (defaulters[i]) {
            totalDefaulted++;
        }
        if (expelledMembers[i]) {
            //console.log("Is expelled");
            totalExpelled++;
        }
    }

    let ethPrice = await collateral.methods.getLatestPrice().call();
    let ethPriceInUSD = ethPrice / 10 ** 18;

    //const wb = new ExcelJS.Workbook();
    const fileName = path.join(__dirname, "./Simulation_template.xlsx");
    //const outPath = path.join(__dirname, outCSV);
    //await wb.xlsx.readFile(fileName)

    let csv = [];
    csv.push([,,currentCycle,,,chosenBeneficiaryIndex + 1,,,ethPriceInUSD,,,,,,,].join(";"));
    csv.push([,,startingParticipants,,,totalPaidThisCycle,,,,,,,,closeFundReason,,].join(";"));
    csv.push([,,currentParticipants,,,totalDefaulted,,,,,locallyManipulatedBalance,,,,,].join(";"));
    csv.push([,,contribution,,,totalExpelled,,,,,,,,,,].join(";"));
    csv.push(["", "",,,,,,,,,,,,,,].join(";"));
    csv.push(["", "",,,,,,,,,,,,,,].join(";"));
    for (let i = 0; i < totalParticipants; i++) {
        csv.push([i + 1,
                paidThisCycle[i] ? "Yes" : "No", 
                hasBeenBeneficiary[i] ? "Yes" : "No", 
                expelledMembers[i] ? "Yes" : "No",
                isUnderCollaterized[i] ? "Yes" : "No",
                ,
                collateralAmounts[i] * ethPriceInUSD,
                collateralAmounts[i],
                ,
                ,
                ,
                claimedCollaterals[i],,,,
                //balances[i] + collateralPayments[i] * ethPriceInUSD,
                /*(collateralPayments[i] + collateralAmounts[i] - 0.044)*/].join(";"));
    }
    csv.push(["", "",,,,,,,,,,,,,,].join(";"));
    //csv.push("\n");

    let outCSV = csv.join("\n");
    outCSV = outCSV + "\n";

    fs.appendFileSync(outPath, outCSV, function (err) {
        if (err) throw err;
        console.log('Saved!');
    });

}

async function executeCycle(defaultersAmount = 0, specificDefaultersIndices = [], newEthPrice = 0, outPath = path.join(__dirname, "./Simulation_output.csv")) {
    
    let state = await fund.methods.currentState().call();
    if (state == 4) { // FundClosed
        return;
    }

    if (newEthPrice > 0) {
        await collateral.methods.setSimulationEthPrice(web3.utils.toWei(newEthPrice.toString(), "ether")).send({
            from: accounts[12]
        });
    }

    let randomDefaulterIndices = specificDefaultersIndices;
    claimedCollaterals = [];
    let currentCycle = parseInt(await fund.methods.currentCycle().call());

    while (defaultersAmount != randomDefaulterIndices.length) {
        if (defaultersAmount > totalParticipants) {
            //console.log("Too many defaulters specified!");
            break;
        }
        let generatedInt = randomInt(totalParticipants);
        
        if (!randomDefaulterIndices.includes(generatedInt)) {
            //console.log("Defaulting user..");
            randomDefaulterIndices.push(generatedInt);
        }
    }

    let paidAmount = 0 ;
    for (let i = 0; i < totalParticipants; i++) {

        if (randomDefaulterIndices.includes(i)) {
            continue;
        }
        else {
            receipt = await usdc.methods.approve(fund.options.address, contributionAmount * 10 ** 6).send({
                from: accounts[i]
            });

            appendGasLog(receipt.to, receipt.from, "approve(address spender, uint256 value)", receipt.gasUsed);
            
            try {
                receipt = await fund.methods.payContribution().send({
                    from: accounts[i]
                });
                
                appendGasLog(receipt.to, receipt.from, "payContribution()", receipt.gasUsed);

                paidAmount++;
            }
            catch (e) { }
        }
    }

    // Artifically increase time to skip the wait
    await network.provider.send("evm_increaseTime", [contributionPeriod + 1]);
    await network.provider.send("evm_mine");

    receipt = await fund.methods.closeFundingPeriod().send({
        from: accounts[12]
    });

    appendGasLog(receipt.to, receipt.from, "closeFundingPeriod()", receipt.gasUsed);

    state = await fund.methods.currentState().call();
    assert.ok(state != 1); // state is not equal to acceptingContributions
    let fundClaimed = false;
    let claimant;
    let previousBalanceClaimant = 0;
    for (let i = 0; i < totalParticipants; i++) {
        try {
            claimant = accounts[i];
            previousBalanceClaimant = await usdc.methods.balanceOf(claimant).call();
            receipt = await fund.methods.withdrawFund().send({
                from: accounts[i]
            });
            appendGasLog(receipt.to, receipt.from, "withdrawFund()", receipt.gasUsed);
        }
        catch (e) {}
        try{
            let ethPrice = await collateral.methods.getLatestPrice().call();
            let ethPriceInUSD = ethPrice / 10 ** 18;
            
            let claimedCollateral = await collateral.methods.collateralPaymentBank(accounts[i]).call() / 10 ** 18;
            //console.log(claimedCollateral);
            claimedCollaterals[i] = claimedCollateral;
            claimedEthBalances[i] = claimedEthBalances[i] + claimedCollateral * ethPriceInUSD;

            receipt = await collateral.methods.withdrawReimbursement().send({
                from: accounts[i]
            });

            appendGasLog(receipt.to, receipt.from, "withdrawReimbursement()", receipt.gasUsed);

            //console.log("Fund claimed by: " + accounts[i]);
            fundClaimed = true
            //break;
        }
        catch (e) {}
    }

    // Artifically increase time to skip the wait
    await network.provider.send("evm_increaseTime", [cycleTime + 1]);
    await network.provider.send("evm_mine");

    await makeExcelSheet(outPath);

    try {
        receipt = await fund.methods.startNewCycle().send({
            from: accounts[12]
        });
        appendGasLog(receipt.to, receipt.from, "startNewCycle()", receipt.gasUsed);
    }
    catch (e) { }

    let newCycle = parseInt(await fund.methods.currentCycle().call());
    let newCycleStarted = (currentCycle + 1) == newCycle;
    //console.log(newCycleStarted);
    //console.log(await fund.methods.currentState().call());
    let fundClosed = parseInt(await fund.methods.currentState().call()) == 4; // FundClosed



    if (fundClosed) {
        assert.ok(true);

        // Try claim fund for the last time
        
        for (let i = 0; i < totalParticipants; i++) {
            try {
                claimant = accounts[i];
                previousBalanceClaimant = await usdc.methods.balanceOf(claimant).call();
                receipt = await fund.methods.withdrawFund().send({
                    from: accounts[i]
                });
                appendGasLog(receipt.to, receipt.from, "withdrawFund()", receipt.gasUsed);
            }
            catch (e) {}
            try{
                let ethPrice = await collateral.methods.getLatestPrice().call();
                let ethPriceInUSD = ethPrice / 10 ** 18;
                
                let claimedCollateral = await collateral.methods.collateralPaymentBank(accounts[i]).call() / 10 ** 18;
                //console.log(claimedCollateral);
                claimedCollaterals[i] = claimedCollateral;
                claimedEthBalances[i] = claimedEthBalances[i] + claimedCollateral * ethPriceInUSD;
    
                receipt = await collateral.methods.withdrawReimbursement().send({
                    from: accounts[i]
                });
    
                appendGasLog(receipt.to, receipt.from, "withdrawReimbursement()", receipt.gasUsed);
    
                //console.log("Fund claimed by: " + accounts[i]);
                fundClaimed = true
                //break;
            }
            catch (e) {}
        }
    }
    else {
        assert.ok(newCycleStarted); 
    }

    let balanceClaimant = await usdc.methods.balanceOf(claimant).call();
    //console.log(balanceClaimant - previousBalanceClaimant);
    //console.log(contributionAmount * paidAmount);
    let balanceClaimantOk = (balanceClaimant - previousBalanceClaimant) == contributionAmount * 10 ** 6 * paidAmount;
    let balanceFund = await usdc.methods.balanceOf(fund.options.address).call();
    //let balanceFundOk = balanceFund == 0;
    let poolEmpty = await fund.methods.beneficiariesPool(claimant).call();
    //console.log(poolEmpty);
    let poolEmptyOk = poolEmpty == 0

    if (!fundClaimed) {
        assert.ok(true);
    }
    else {
        assert.ok(fundClaimed);
        //assert.ok(balanceClaimantOk);
        //assert.ok(balanceFundOk);
        assert.ok(poolEmptyOk);
    }
    return fundClosed;

}

describe('Simulations', function() {
    beforeEach(async function() {
        accounts = await web3.eth.getAccounts();
        
        gasLog = [];
        // accounts used:
        // 0 - 11: participants
        // 12: fund contract owner
    
        usdc = new web3.eth.Contract(ERC20abi, USDC_ADDRESS); //USDC Polygon Testnet
        
        participants = [];
        for (let i = 0; i < totalParticipants; i++) {
            participants.push(accounts[i]);
        }
    
        factory = await new web3.eth.Contract(compiledFactory.abi)
        .deploy({ data: compiledFactory.bytecode })
        .send({ from: accounts[12], gas: "14000000" });

        appendGasLog(factory.options.address, accounts[12], "Factory deployment", 4689897);
    
        // create collateral contract to provide as input
        receipt = await factory.methods.createCollateral(totalParticipants, 
            cycleTime, 
            contributionAmount, 
            contributionPeriod, 
            collateralAmount,
            web3.utils.toWei("0.055", "ether"),
            "0x07865c6E87B9F70255377e024ace6630C1Eaa37F",
            "0xD4a33860578De61DBAbDc8BFdb98FD742fA7028e"
            ).send({ from: accounts[12], gas: "10000000" });

        appendGasLog(receipt.to, receipt.from, "createCollateral(uint totalParticipants, uint cycleTime, uint contributionAmount, uint contributionPeriod, uint collateralAmount)", receipt.gasUsed);
    
        [collateralAddress] = await factory.methods.getDeployedCollaterals().call();
        collateral = await new web3.eth.Contract(compiledCollateral.abi, collateralAddress);
    
        await collateral.methods.setSimulationEthPrice(web3.utils.toWei("1500", "ether")).send({
            from: accounts[12]
        });

        for (let i = 0; i < totalParticipants; i++) {
            receipt = await collateral.methods.depositCollateral().send({
                value: web3.utils.toWei("0.055", "ether"), 
                from: accounts[i]
            });

            appendGasLog(receipt.to, receipt.from, "depositCollateral()", receipt.gasUsed);

        }

        await collateral.methods.initiateFundContract().send({ from: accounts[12], gas: "10000000" });

        let newFundAddress = await collateral.methods.fundContract().call();
        fund = await new web3.eth.Contract(compiledFund.abi, newFundAddress); 

        let userAddress;
        let balance;
        for(let i = 0; i < totalParticipants; i++) {
            userAddress = accounts[i];

            // Get storage slot index
            const index = web3.utils.soliditySha3(
                {type: 'uint256', value: userAddress}, 
                {type: 'uint256', value: USDC_SLOT}
            );

            // Manipulate local balance (needs to be bytes32 string)
            await hre.network.provider.send( //is there a web3 eq?
                "hardhat_setStorageAt",
                [
                    USDC_ADDRESS, //usdc.options.address
                    index, //.toString(),
                    web3.utils.toHex(web3.utils.padLeft(locallyManipulatedBalance, 64))
                ]
            );

            // check that the user balance is equal to the expected value
            balance = await usdc.methods.balanceOf(userAddress).call();
        }
    });

    async function randomSimulation(outPath, ethLower = 800, ethHigher = 2000, shouldGracefulLimit = false) {
        fs.writeFileSync(outPath, "", (err) => {
            if (err) {
                console.error(err);
            }
        });

        await collateral.methods.toggleGracefulLimit(shouldGracefulLimit).send({
            from: accounts[12]
        });


        //gasLog = [];
        //console.log(initialGasLog);
        gasPath = outPath.replace(".csv", "_gasLog.csv");
/*
        fs.writeFileSync(gasPath, "", (err) => {
            if (err) {
                console.error(err);
            }
        });*/

        claimedEthBalances = [];
        for (let i = 0; i < totalParticipants; i++) {
            claimedEthBalances.push(0);
        }   

        for (let i = 0; i < totalParticipants; i++) {
            //console.log("Current Cycle, %s", (i + 1).toString());
            let closed = await executeCycle(randomInt(parseInt(await fund.methods.totalParticipants().call())), [], randomInt(ethLower * 100, ethHigher * 100) / 100, outPath);

            if (closed) {
                //console.log("Fund closed!");
                break;
            }
        }

        for (let i = 0; i < totalParticipants; i++) {
            try {
                receipt = await fund.methods.withdrawFund().send({
                    from: accounts[i]
                });

                appendGasLog(receipt.to, receipt.from, "withdrawFund()", receipt.gasUsed);
                console.log("Fund claimed by: " + accounts[i]);
            }
                catch (e) {}
        }

        let outGasLog = gasLog.join("\n");
        outGasLog = outGasLog + "\n";
        fs.writeFileSync(gasPath, outGasLog, (err) => {
            if (err) {
                console.error(err);
            }
        });
    }

    async function lastBeneficiaryDefaultedSimulation(outPath, everyonePays = false, lowEth = false) {
        fs.writeFileSync(outPath, "", (err) => {
            if (err) {
                console.error(err);
            }
        });

        //gasLog = [];
        gasPath = outPath.replace(".csv", "_gasLog.csv");
/*
        fs.writeFileSync(gasPath, "", (err) => {
            if (err) {
                console.error(err);
            }
        });*/

        let ethLower = 800;
        let ethHigher = 2000;

        if (lowEth) {
            ethLower = 400;
            ethHigher = 600;
        }

        claimedEthBalances = [];
        for (let i = 0; i < totalParticipants; i++) {
            claimedEthBalances.push(0);
        }   

        for (let i = 0; i < totalParticipants; i++) {

            let randomDefaultersAmount = 0;

            if (!everyonePays) {
                randomDefaultersAmount = randomInt(parseInt(await fund.methods.totalParticipants().call()))
            }

            let nonBeneficiaries = [];
            for (let j = 0; j < totalParticipants; j++) {
                if(!(await fund.methods.isBeneficiary(participants[j]).call())) {
                    nonBeneficiaries.push(j);
                }
            }

            let closed = false;
            if (nonBeneficiaries.length == 1) {
                randomDefaultersAmount = Math.max(1, randomDefaultersAmount);
                closed = await executeCycle(randomDefaultersAmount, nonBeneficiaries, randomInt(ethLower * 100, ethHigher * 100) / 100, outPath);
            }
            else {
                closed = await executeCycle(randomDefaultersAmount, [], randomInt(ethLower * 100, ethHigher * 100) / 100, outPath);
            }
            
            if (closed) {
                break;
            }
        }

        for (let i = 0; i < totalParticipants; i++) {
            try {
                receipt = await fund.methods.withdrawFund().send({
                    from: accounts[i]
                });

                appendGasLog(receipt.to, receipt.from, "withdrawFund()", receipt.gasUsed);
                console.log("Fund claimed by: " + accounts[i]);
            }
                catch (e) {}
        }

        let outGasLog = gasLog.join("\n");
        outGasLog = outGasLog + "\n";
        fs.writeFileSync(gasPath, outGasLog, (err) => {
            if (err) {
                console.error(err);
            }
        });

        //gasLog = [];
    }

    async function everyoneDefaultedSimulation(outPath, everyonePays = false, lowEth = false, defaultAtcycle = totalParticipants) {
        fs.writeFileSync(outPath, "", (err) => {
            if (err) {
                console.error(err);
            }
        });

        //gasLog = [];
        gasPath = outPath.replace(".csv", "_gasLog.csv");
/*
        fs.writeFileSync(gasPath, "", (err) => {
            if (err) {
                console.error(err);
            }
        });*/

        let ethLower = 800;
        let ethHigher = 2000;

        if (lowEth) {
            ethLower = 400;
            ethHigher = 600;
        }

        claimedEthBalances = [];
        for (let i = 0; i < totalParticipants; i++) {
            claimedEthBalances.push(0);
        }   

        for (let i = 0; i < totalParticipants; i++) {

            let randomDefaultersAmount = 0;

            if (!everyonePays) {
                randomDefaultersAmount = randomInt(parseInt(await fund.methods.totalParticipants().call()))
            }


            let closed = false;

            if (defaultAtcycle == i) {
                defaulting = []
                for (let j = 0; j < totalParticipants; j++) {
                    defaulting.push(j);
                }
                closed = await executeCycle(totalParticipants, defaulting, randomInt(ethLower * 100, ethHigher * 100) / 100, outPath);
            }
            else {
                closed = await executeCycle(randomDefaultersAmount, [], randomInt(ethLower * 100, ethHigher * 100) / 100, outPath);
            }
            
            if (closed) {
                break;
            }
        }

        for (let i = 0; i < totalParticipants; i++) {
            try {
                receipt = await fund.methods.withdrawFund().send({
                    from: accounts[i]
                });
                appendGasLog(receipt.to, receipt.from, "withdrawFund()", receipt.gasUsed);
                console.log("Fund claimed by: " + accounts[i]);
            }
                catch (e) {}
        }

        let outGasLog = gasLog.join("\n");
        outGasLog = outGasLog + "\n";
        fs.writeFileSync(gasPath, outGasLog, (err) => {
            if (err) {
                console.error(err);
            }
        });

        //gasLog = [];
    }

    // Completely random
    for (let i = 0; i < 10; i++) {
        it(('simulation - random ' + (i + 1).toString()), async function() {
            this.timeout(200000);
    
            const outPath = path.join(__dirname, ("./simulations/fullRandom/random_" + (i + 1).toString() + ".csv"));
            await randomSimulation(outPath);
        });
    }

    // Completely random, low eth
    for (let i = 0; i < 10; i++) {

        it(('simulation - random, low eth ' + (i + 1).toString()), async function() {
            this.timeout(200000);
    
            const outPath = path.join(__dirname, ("./simulations/fullRandom/randomLowEth_" + (i + 1).toString() + ".csv"));
            await randomSimulation(outPath, 400, 600);
        });
    }

    // Edge case where last beneficiary defaulted that same cycle, everyone paid correctly before
    for (let i = 0; i < 2; i++) {

        it(('simulation - last beneficiary defaulted but everyone pays ' + (i + 1).toString()), async function() {
            this.timeout(200000);

            const outPath = path.join(__dirname, ("./simulations/lastDefaults/lastDefaultsPaid_" + (i + 1).toString() + ".csv"));
            await lastBeneficiaryDefaultedSimulation(outPath, true);
        });
    }

    // Edge case where last beneficiary defaulted that same cycle, the rest is random
    for (let i = 0; i < 10; i++) {

        it(('simulation - last beneficiary defaulted, rest is random ' + (i + 1).toString()), async function() {
            this.timeout(200000);

            const outPath = path.join(__dirname, ("./simulations/lastDefaults/lastDefaultsRandom_" + (i + 1).toString() + ".csv"));
            await lastBeneficiaryDefaultedSimulation(outPath);
        });
    }

    // Edge case where last beneficiary defaulted that same cycle, the rest is random, eth is low
    for (let i = 0; i < 10; i++) {

        it(('simulation - last beneficiary defaulted, rest is random but eth is low ' + (i + 1).toString()), async function() {
            this.timeout(200000);

            const outPath = path.join(__dirname, ("./simulations/lastDefaults/lastDefaultsRandomLowEth_" + (i + 1).toString() + ".csv"));
            await lastBeneficiaryDefaultedSimulation(outPath, false, true);
        });
    }

    // Edge case where everyone defaults, but paid before
    for (let i = 0; i < totalParticipants; i++) {

        it(('simulation - one cycle where everyone defaults, but everyone paid before ' + (i + 1).toString()), async function() {
            this.timeout(200000);

            const outPath = path.join(__dirname, ("./simulations/everyoneDefaults/everyoneDefaultsPaid_" + (i + 1).toString() + ".csv"));
            await everyoneDefaultedSimulation(outPath, true, false, i + 1);
        });
    }

    // Edge case where everyone defaults, contributions are random
    for (let i = 0; i < totalParticipants; i++) {

        it(('simulation - one cycle where everyone defaults, rest is random ' + (i + 1).toString()), async function() {
            this.timeout(200000);

            const outPath = path.join(__dirname, ("./simulations/everyoneDefaults/everyoneDefaultsRandom_" + (i + 1).toString() + ".csv"));
            await everyoneDefaultedSimulation(outPath, false, false, i + 1);
        });
    }

    // Edge case where everyone defaults, but paid before with low eth
    for (let i = 0; i < totalParticipants; i++) {

        it(('simulation - one cycle where everyone defaults, everone paid before but eth is low ' + (i + 1).toString()), async function() {
            this.timeout(200000);

            const outPath = path.join(__dirname, ("./simulations/everyoneDefaults/everyoneDefaultsPaidLowEth_" + (i + 1).toString() + ".csv"));
            await everyoneDefaultedSimulation(outPath, true, true, i + 1);
        });
    }

    // Edge case where everyone defaults, contributions are random with low eth
    for (let i = 0; i < totalParticipants; i++) {

        it(('simulation - one cycle where everyone defaults, rest is random but eth is low ' + (i + 1).toString()), async function() {
            this.timeout(200000);

            const outPath = path.join(__dirname, ("./simulations/everyoneDefaults/everyoneDefaultsRandomLowEth_" + (i + 1).toString() + ".csv"));
            await everyoneDefaultedSimulation(outPath, false, true, i + 1);
        });
    }
    
    // Attempt to expel people by not being able to pay the fund
    for (let i = 0; i < 10; i++) {
        it(('simulation - cant pay expelled ' + (i + 1).toString()), async function() {
            this.timeout(200000);
    
            const outPath = path.join(__dirname, ("./simulations/cantPayExpel/cantPayExpel_" + (i + 1).toString() + ".csv"));
            await randomSimulation(outPath, 20, 30);
        });
    }

    // Completely random, graceful limit
    for (let i = 0; i < 10; i++) {
        it(('simulation - random, with a graceful under-collaterized limit' + (i + 1).toString()), async function() {
            this.timeout(200000);
    
            const outPath = path.join(__dirname, ("./simulations/gracefulLimit/gracefulLimit_" + (i + 1).toString() + ".csv"));
            await randomSimulation(outPath, 800, 2000, true);
        });
    }

    // Completely random, low eth, graceful limit
    for (let i = 0; i < 10; i++) {
        it(('simulation - random, low eth, with a graceful under-collaterized limit' + (i + 1).toString()), async function() {
            this.timeout(200000);
    
            const outPath = path.join(__dirname, ("./simulations/gracefulLimit/gracefulLimitlowEth_" + (i + 1).toString() + ".csv"));
            await randomSimulation(outPath, 400, 600, true);
        });
    }

});