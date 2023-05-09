// SPDX-License-Identifier: GPL-3.0        

pragma solidity ^0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import "./IFund.sol";
import "./ICollateral.sol";

/// @title Takaturn Fund
/// @author Mohammed Haddouti
/// @notice This is used to operate the Takaturn fund
/// @dev v1.4 (prebeta)
/// @custom:experimental This is still in testing phase.
contract Fund_sim is IFund, Ownable {
    using EnumerableSet for EnumerableSet.AddressSet;

    /// Insufficient balance for transfer. Needed `required` but only
    /// `available` available.
    /// @param available balance available.
    /// @param required requested amount to transfer.
    error InsufficientBalance(uint256 available, uint256 required);

    event OnContractDeployed(); // Emits when contract is deployed
    event OnStateChanged(States indexed newState); // Emits when state has updated
    event OnPaidContribution(address indexed payer, uint indexed currentCycle, uint indexed amount); // Emits when participant pays the contribution
    event OnBeneficiarySelected(address indexed beneficiary); // Emits when beneficiary is selected for this cycle
    event OnFundWithdrawn(address indexed claimant, uint indexed amount); // Emits when a chosen beneficiary claims their fund
    event OnParticipantDefaulted(address indexed defaulter); // Emits when a participant didn't pay this cycle's contribution
    event OnParticipantUndefaulted(address indexed undefaulter); // Emits when a participant was a defaulter before but started paying on time again for this cycle
    event OnDefaulterExpelled(address indexed expellant); // Emits when a defaulter can't compensate with the collateral
    event OnTotalParticipantsUpdated(uint indexed newLength); // Emits when the total participants lengths has changed from its initial value
    event OnAutoPayToggled(address indexed participant, bool indexed enabled); // Emits when a participant succesfully toggles autopay

    uint public version; // The version of the contract

    ICollateral immutable public collateral; // Instance of the collateral
    IERC20 immutable public stableToken; // Instance of the stable token

    States public currentState = States.InitializingFund; // Variable to keep track of the different States

    uint public totalAmountOfCycles; // Amount of cycles that this fund will have
    uint public totalParticipants; // Total amount of starting participants
    uint immutable public cycleTime; // time for a single cycle in seconds, default is 30 days
    uint immutable public contributionAmount; // amount in stable token currency, 6 decimals
    uint immutable public contributionPeriod; // time for participants to contribute this cycle

    mapping(address => bool) public isParticipant; // Mapping to keep track of who's a participant or not
    mapping(address => bool) public isBeneficiary; // Mapping to keep track of who's a beneficiary or not
    mapping(address => bool) public paidThisCycle; // Mapping to keep track of who paid for this cycle
    mapping(address => bool) public autoPayEnabled; // Wheter to attempt to automate payments at the end of the contribution period
    mapping(address => uint) public beneficiariesPool; // Mapping to keep track on how much each beneficiary can claim
    mapping(address => uint) public successfullPayments; // Mapping to keep track how often someone paid on time
    EnumerableSet.AddressSet private participants; // Those who have not been beneficiaries yet and have not defaulted this cycle
    EnumerableSet.AddressSet private beneficiaries; // Those who have been beneficiaries and have not defaulted this cycle
    EnumerableSet.AddressSet private defaulters; // Both participants and beneficiaries who have defaulted this cycle

    //address[] public participants; // those who have not been beneficiaries yet and have not defaulted this cycle
    //address[] public beneficiaries; // those who have been beneficiaries and have not defaulted this cycle
    //address[] public defaulters; // both participants and beneficiaries who have defaulted this cycle
    address[] public beneficiariesOrder; // The correct order of who gets to be next beneficiary, determined by collateral contract
    uint public expelledParticipants; // Total amount of participants that have been expelled so far

    uint public currentCycle = 0; // Index of current cycle
    uint public fundStart = 0; // Timestamp of the start of the fund
    uint public fundEnd = 0; // Timestamp of the end of the fund
    //uint public contributionEnd; // Timestamp of the end of the contribution period

    address public lastBeneficiary; // The last selected beneficiary, updates with every cycle

    string public closeFundReason = "";

    
    /// @notice Constructor Function
    /// @dev Network is Arbitrum and Stable Token is USDC
    /// @param _stableTokenAddress Address of the stable token contract
    /// @param _participants An array of all participants
    /// @param _cycleTime The time it takes to finish 1 cycle
    /// @param _contributionAmount The amount participants need to pay per cycle, amount in whole dollars
    /// @param _contributionPeriod The amount of time participants have to pay the contribution of a cycle, must be less than cycle time
    /// @param _sender The original sender of the message, this should be a collateral contract
    constructor(
        address _stableTokenAddress,
        address[] memory _participants,
        uint _cycleTime,
        uint _contributionAmount,
        uint _contributionPeriod,
        address _sender
    ) {
        collateral = ICollateral(_sender);
        stableToken = IERC20(_stableTokenAddress);

        transferOwnership(Ownable(_sender).owner());
        
        // Set and track participants
        for (uint i = 0; i < _participants.length; i++) {
            EnumerableSet.add(participants, _participants[i]);
            isParticipant[_participants[i]] = true;
            successfullPayments[_participants[i]] = 0;
        }
        beneficiariesOrder = _participants;

        // Sets some cycle-related parameters
        totalParticipants = _participants.length;
        totalAmountOfCycles = _participants.length;
        cycleTime = _cycleTime;
        contributionAmount = _contributionAmount * 10 ** 6; // Convert to 6 decimals
        contributionPeriod = _contributionPeriod;

        // Sets the version of the contract
        version = 1;

        emit OnContractDeployed();

        // Starts the first cycle
        _startNewCycle();
        
        // Set timestamp of deployment, which will be used to determine cycle times
        // We do this after starting the first cycle to make sure the first cycle starts smoothly
        fundStart = block.timestamp;
    }

    /// @notice updates the state according to the input and makes sure the state can't be changed if the fund is closed. Also emits an event that this happened
    /// @param newState The new state of the fund
    function _setState(States newState) internal {
        require (currentState != States.FundClosed, "Fund's closed");
        currentState = newState;
        emit OnStateChanged(newState);
    }

    /// @notice This starts the new cycle and can only be called internally. Used upon deploy
    function _startNewCycle() internal {
        // currentCycle is 0 when this is called for the first time
        require(block.timestamp > cycleTime * currentCycle + fundStart, "Too early to start new cycle");
        require(currentState == States.InitializingFund || currentState == States.CycleOngoing, "Wrong state");
        
        currentCycle++;
        uint length = beneficiariesOrder.length;
        for (uint i = 0; i < length; i++) {
            paidThisCycle[beneficiariesOrder[i]] = false;
        }

        _setState(States.AcceptingContributions);
    }

    /// @notice function to pay the actual contribution for the cycle
    /// @param payer the address that's paying
    /// @param participant the (participant) address that's being paid for
    function _payContribution(address payer, address participant) internal {
        // Get the amount and do the actual transfer, this will only succeed if the sender approved this contract address beforehand
        uint amount = contributionAmount;
        
        bool success = stableToken.transferFrom(payer, address(this), amount);
        require(success, "Contribution failed, did you approve stable token contract?");

        // Finish up, set that the participant paid for this cycle and emit an event that it's been done
        paidThisCycle[participant] = true;
        successfullPayments[payer] = successfullPayments[payer] + 1;
        emit OnPaidContribution(participant, currentCycle, amount);
    }

    /// @notice Default the participant/beneficiary by checking the mapping first, then remove them from the appropriate array
    /// @param defaulter The participant to default
    function _defaultParticipant(address defaulter) internal {
        // Try removing from participants first
        bool success = EnumerableSet.remove(participants, defaulter);

        // If that fails, we try removing from beneficiaries
        if (!success) {
            success = EnumerableSet.remove(beneficiaries, defaulter);
        }

        require (success, "Could not remove defaulter");
        EnumerableSet.add(defaulters, defaulter);

        emit OnParticipantDefaulted(defaulter);
    }

    /// @notice The beneficiary will be selected here based on the beneficiariesOrder array.
    /// @notice It will loop through the array and choose the first in line to be eligible to be beneficiary.
    function _selectBeneficiary() internal {
        // check if there are any participants left, else use the defaulters
        address selectedBeneficiary = address(0);
        address[] memory arrayToCheck = beneficiariesOrder;
        uint beneficiaryIndex = 0;
        for (uint i = 0; i < arrayToCheck.length; i++) { 
            address b = arrayToCheck[i];
            if (!isBeneficiary[b]) {
                selectedBeneficiary = b;
                beneficiaryIndex = i;
                break;
            }
        }

        // If the defaulter didn't pay this cycle, we move the first elligible beneficiary forward and everyone in between forward
        if (!paidThisCycle[selectedBeneficiary]) {
            // Find the index of the beneficiary to move to the end
            for (uint i = beneficiaryIndex; i < arrayToCheck.length; i++) {
                address b = arrayToCheck[i];
                // Find the first eligible beneficiary
                if (paidThisCycle[b]) {
                    selectedBeneficiary = b;
                    address[] memory newOrder = beneficiariesOrder;
                    // Move each defaulter between current beneficiary and new beneficiary 1 position forward
                    for (uint j = beneficiaryIndex; j < i; j++) {
                        newOrder[j + 1] = arrayToCheck[j];
                    }
                    // Move new beneficiary to original beneficiary's position
                    newOrder[beneficiaryIndex] = selectedBeneficiary;
                    beneficiariesOrder = newOrder;
                    break;
                }
            }
        }

        // Request contribution from the collateral for those who haven't paid this cycle
        if (EnumerableSet.length(defaulters) > 0) {
            address[] memory expellants = collateral.requestContribution(selectedBeneficiary, EnumerableSet.values(defaulters));

            for (uint i = 0; i < expellants.length; i++) {
                if (expellants[i] == address(0)) {
                    continue;
                }
                _expelDefaulter(expellants[i]);
            }
        }
        
        // Remove participant from participants set..
        if (EnumerableSet.remove(participants, selectedBeneficiary)) {
            // ..Then add them to the benificiaries set
            EnumerableSet.add(beneficiaries, selectedBeneficiary);
        } // If this if-statement fails, this means we're dealing with a graced defaulter

        // Update the mapping to track who's been beneficiary
        isBeneficiary[selectedBeneficiary] = true;

        // Get the amount of participants that paid this cycle, and add that amount to the beneficiary's pool
        uint paidCount = 0;
        address[] memory allParticipants = beneficiariesOrder; // Use beneficiariesOrder here because it contains all active participants in a single array
        for (uint i = 0; i < allParticipants.length; i++) {
            if (paidThisCycle[allParticipants[i]]) {
                paidCount++;
            }
        }
 
        // Award the beneficiary with the pool and update the lastBeneficiary
        beneficiariesPool[selectedBeneficiary] = contributionAmount * paidCount;
        lastBeneficiary = selectedBeneficiary;
        
        emit OnBeneficiarySelected(selectedBeneficiary);
        _setState(States.CycleOngoing);
    }

    /// @notice Called internally to move a defaulter in the beneficiariesOrder to the end, so that people who have paid get chosen first as beneficiary
    /// @param _beneficiary The defaulter that could have been beneficiary
    function _removeBeneficiaryFromOrder(address _beneficiary) internal {
        address[] memory arrayToCheck = beneficiariesOrder;
        address[] memory newArray = new address[](arrayToCheck.length - 1);
        uint j = 0;
        for (uint i = 0; i < arrayToCheck.length; i++) {
            address b = arrayToCheck[i];
            if (b != _beneficiary) {
                newArray[j] = b;
                j++;
            }
        }

        beneficiariesOrder = newArray;
    }

    /// @notice called internally to expel a participant. It should not be possible to expel non-defaulters, so those arrays are not checked.
    /// @param expellant The address of the defaulter that will be expelled
    function _expelDefaulter(address expellant) internal {
        //require(msg.sender == address(collateral), "Caller is not collateral");
        require (isParticipant[expellant], "Expellant not part of fund");
  
          // Expellants should only be in the defauters set so no need to touch the other sets
        require(EnumerableSet.remove(defaulters, expellant), "Expellant not found");

        // Remove expellant from beneficiaries order
        // Remove expellants from participants tracker and emit that they've been expelled
        // Update the defaulters array
        _removeBeneficiaryFromOrder(expellant);

        isParticipant[expellant] = false;
        emit OnDefaulterExpelled(expellant);

        // If the participant is expelled before becoming beneficiary, we lose a cycle, the one which this expellant is becoming beneficiary
        if (!isBeneficiary[expellant]) {
            totalAmountOfCycles--;
        }

        // Lastly, lower the amount of participants with the amount expelled
        uint newLength = totalParticipants - 1;
        totalParticipants = newLength;
        expelledParticipants++;
        
        emit OnTotalParticipantsUpdated(newLength);
    }
    
    /// @notice Internal function for close fund which is used by _startNewCycle & _chooseBeneficiary to cover some edge-cases
    function _closeFund(string memory reason) internal {
        fundEnd = block.timestamp;
        _setState(States.FundClosed);
        closeFundReason = reason;

        collateral.releaseCollateral();
    }
    
    /// @notice starts a new cycle manually called by the owner. Only the first cycle starts automatically upon deploy
    function startNewCycle() external onlyOwner {
        _startNewCycle();
    }

    /// @notice Must be called at the end of the contribution period after the time has passed by the owner
    function closeFundingPeriod() external onlyOwner {
        // Current cycle minus 1 because we use the previous cycle time as start point then add contribution period
        require(block.timestamp > cycleTime * (currentCycle - 1) + fundStart + contributionPeriod, "There's still time to contribute");
        require(currentState == States.AcceptingContributions, "Wrong State");

        // Before closing, we attempt to make the autopayers pay
        address[] memory autoPayers = beneficiariesOrder;
        uint amount = contributionAmount;
        for (uint i = 0; i < autoPayers.length; i++) {
            if (autoPayEnabled[autoPayers[i]] && 
                !paidThisCycle[autoPayers[i]] &&
                amount <= stableToken.allowance(autoPayers[i], address(this)) &&
                amount <= stableToken.balanceOf(autoPayers[i])) {
                _payContribution(autoPayers[i], autoPayers[i]);
            }
        }

        // Only then start choosing beneficiary
        _setState(States.ChoosingBeneficiary);

        // We must check who hasn't paid and default them, check all participants based on beneficiariesOrder
        // To maintain the order and to properly push defaulters to the back based on that same order
        // And we make sure that existing defaulters are ignored
        address[] memory currentParticipants = beneficiariesOrder;
        for (uint i = 0; i < currentParticipants.length; i++) {
            address p = currentParticipants[i];
            if (paidThisCycle[p]) {
                // check where to restore the defaulter to, participants or beneficiaries
                if (isBeneficiary[p]) {
                    EnumerableSet.add(beneficiaries, p);
                }
                else {
                    EnumerableSet.add(participants, p);
                }

                if (EnumerableSet.remove(defaulters, p)) {
                    emit OnParticipantUndefaulted(p);
                }
            }
            else if (!EnumerableSet.contains(defaulters, p)){
                _defaultParticipant(p);
            }
        }

        // Once we decided who defaulted and who paid, we can select the beneficiary for this cycle
        _selectBeneficiary();

        if (!(currentCycle < totalAmountOfCycles)) { // If all cycles have passed, and the last cycle's time has passed, close the fund
            _closeFund("All cycles have passed");
            return;
        }
    }
    
    /// @notice Fallback function, if the internal call fails somehow and the state gets stuck, allow owner to call the function again manually
    /// @dev This shouldn't happen, but is here in case there's an edge-case we didn't take into account, can possibly be removed in the future
    function selectBeneficiary() external onlyOwner {
        require(currentState == States.ChoosingBeneficiary, "Wrong State");
        _selectBeneficiary();
    }
    
    /// @notice called by the owner to close the fund for emergency reasons.
    function closeFund() external onlyOwner {
        //require (!(currentCycle < totalAmountOfCycles), "Not all cycles have happened yet");
        _closeFund("Manually closed by owner");
    }

    // @notice allow the owner to empty the fund if there's any excess fund left after 180 days,
    //         this with the assumption that beneficiaries can't claim it themselves due to losing their keys for example,
    //         and prevent the fund to be stuck in limbo
    function emptyFundAfterEnd() external onlyOwner {
        require(currentState == States.FundClosed && block.timestamp > fundEnd + 180 days, "Can't empty yet");

        uint balance = stableToken.balanceOf(address(this));
        if (balance > 0) {
            stableToken.transfer(msg.sender, balance);
        }
    }

    /// @notice function to enable/disable autopay
    function toggleAutoPay() external {
        require(isParticipant[msg.sender], "Caller not participant");
        bool enabled = !autoPayEnabled[msg.sender];
        autoPayEnabled[msg.sender] = enabled;

        emit OnAutoPayToggled(msg.sender, enabled);
    }

    /// @notice This is the function participants call to pay the contribution
    function payContribution() external {
        require(currentState == States.AcceptingContributions, "Wrong State");
        require(isParticipant[msg.sender], "not a participant");
        require(!paidThisCycle[msg.sender], "Already paid for this cycle");
        _payContribution(msg.sender, msg.sender);
    }

    /// @notice This function is here to give the possibility to pay using a different wallet
    /// @param participant the address the msg.sender is paying for, the address must be part of the fund
    function payContributionOnBehalfOf(address participant) external {
        require(currentState == States.AcceptingContributions, "Wrong State");
        require(isParticipant[participant], "not a participant");
        require(!paidThisCycle[participant], "Already paid for this cycle");
        _payContribution(msg.sender, participant);
    }
    
    /// @notice Called by the beneficiary to withdraw the fund
    /// @dev This follows the pull-over-push pattern.
    function withdrawFund() external {
        require(currentState == States.FundClosed || 
                paidThisCycle[msg.sender], "You must pay your cycle before withdrawing");

        bool hasFundPool = beneficiariesPool[msg.sender] > 0;
        (, uint collateralPool,) = collateral.getParticipantSummary(msg.sender);
        bool hasCollateralPool = collateralPool > 0;
        require(hasFundPool || hasCollateralPool, "No funds to withdraw");

        if (hasFundPool) {
            // Get the amount this beneficiary can withdraw
            uint transferAmount = beneficiariesPool[msg.sender];
            uint contractBalance = stableToken.balanceOf(address(this));
            if (contractBalance < transferAmount) {
                revert InsufficientBalance({
                    available: contractBalance,
                    required: transferAmount
                });
            }
            else {
                beneficiariesPool[msg.sender] = 0;
                stableToken.transfer(msg.sender, transferAmount); // Untrusted
            }
            emit OnFundWithdrawn(msg.sender, transferAmount);
        }

        if (hasCollateralPool) {
            collateral.withdrawReimbursement(msg.sender);
        }
    }

    // @notice returns the time left for this cycle to end
    function getRemainingCycleTime() external view returns (uint) {
        uint cycleEndTimestamp = cycleTime * currentCycle + fundStart;
        if (block.timestamp > cycleEndTimestamp) {
            return 0;
        } 
        else {
            return block.timestamp - cycleEndTimestamp;
        }

    }

    // @notice returns the time left to contribute for this cycle
    function getRemainingContributionTime() external view returns (uint) {
        if (currentState != States.AcceptingContributions) {
            return 0;
        }

        // Current cycle minus 1 because we use the previous cycle time as start point then add contribution period
        uint contributionEndTimestamp = cycleTime * (currentCycle - 1) + fundStart + contributionPeriod;
        if (block.timestamp > contributionEndTimestamp) {
            return 0;
        }
        else {
            return block.timestamp - contributionEndTimestamp;
        }
    }

    /// @notice returns the beneficiaries order as an array
    function getBeneficiariesOrder() external view returns (address[] memory) {
        return beneficiariesOrder;
    }

    // @notice function to get the cycle information in one go
    function getFundSummary() external view returns (States, uint, address) {
        return (currentState, currentCycle, lastBeneficiary);
    }

    // slightly alter this function so collateral sim can call this without modifying interfaces

    // @notice function to get cycle information of a specific participant
    // @param participant the user to get the info from
    function getParticipantSummary(address participant) external view returns (uint, bool, bool, bool, bool) { 
        return (successfullPayments[participant], isBeneficiary[participant], paidThisCycle[participant], autoPayEnabled[participant], isParticipant[participant]);
    }
}