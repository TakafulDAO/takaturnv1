// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

import "./ITakaturnFactory.sol";
import "./ICollateral.sol";
import "./IFund.sol";

/// @title Takaturn
/// @author Aisha El Allam
/// @notice This is used to operate the Takaturn fund
/// @dev v2.0 (post-deploy)
contract Collateral is ICollateral, Ownable {
    uint public constant version = 2;

    IFund private _fundInstance;
    AggregatorV3Interface public immutable priceFeed;

    uint public totalParticipants;
    uint public collateralDeposit;
    uint public firstDepositTime;
    uint public cycleTime;
    uint public contributionAmount;
    uint public contributionPeriod;
    uint public counterMembers;
    uint public fixedCollateralEth;

    mapping(address => bool) public isCollateralMember; // Determines if a participant is a valid user
    mapping(address => uint) public collateralMembersBank; // Users main balance
    mapping(address => uint) public collateralPaymentBank; // Users reimbursement balance after someone defaults

    address[] public participants;
    address public fundContract;
    address public stableCoinAddress;
    address public factoryContract;

    event OnContractDeployed(address indexed newContract);
    event OnFundContractDeployed(address indexed fund, address indexed collateral);
    event OnStateChanged(States indexed oldState, States indexed newState);
    event OnCollateralDeposited(address indexed user);
    event OnReimbursementWithdrawn(address indexed user, uint indexed amount);
    event OnCollateralWithdrawn(address indexed user, uint indexed amount);
    event OnCollateralLiquidated(address indexed user, uint indexed amount);

    // Function cannot be called at this time.
    error FunctionInvalidAtThisState();

    // Current state.
    States public state = States.AcceptingCollateral;
    uint public creationTime = block.timestamp;
    modifier atState(States _state) {
        if (state != _state) revert FunctionInvalidAtThisState();
        _;
    }

    /// @notice Constructor Function
    /// @dev Network is Arbitrum One and Aggregator is ETH/USD
    /// @param _totalParticipants Max number of participants
    /// @param _cycleTime Time for single cycle (seconds)
    /// @param _contributionAmount Amount user must pay per cycle (USD)
    /// @param _contributionPeriod The portion of cycle user must make payment
    /// @param _collateralAmount Total value of collateral in USD (1.5x of total fund)
    /// @param _creator owner of contract
    constructor(
        uint _totalParticipants,
        uint _cycleTime,
        uint _contributionAmount,
        uint _contributionPeriod,
        uint _collateralAmount,
        uint _fixedCollateralEth,
        address _stableCoinAddress,
        address _aggregatorAddress,
        address _creator
    ) {
        transferOwnership(_creator);

        totalParticipants = _totalParticipants;
        cycleTime = _cycleTime;
        contributionAmount = _contributionAmount;
        contributionPeriod = _contributionPeriod;
        collateralDeposit = _collateralAmount * 10 ** 18; // Convert to Wei
        fixedCollateralEth = _fixedCollateralEth;
        stableCoinAddress = _stableCoinAddress;
        priceFeed = AggregatorV3Interface(_aggregatorAddress);
        factoryContract = msg.sender;

        emit OnContractDeployed(address(this));
    }

    function setStateOwner(States newState) external onlyOwner {
        _setState(newState);
    }

    /// @notice Called by the manager when the cons job goes off
    /// @dev consider making the duration a variable
    function initiateFundContract() external onlyOwner atState(States.AcceptingCollateral) {
        require(fundContract == address(0));
        require(counterMembers == totalParticipants);
        // If one user is under collaterized, then all are.
        require(!_isUnderCollaterized(participants[0]), "Eth prices dropped");

        fundContract = ITakaturnFactory(factoryContract).createFund(
            stableCoinAddress,
            participants,
            cycleTime,
            contributionAmount,
            contributionPeriod
        );

        // TODO: check for success before initiating instance
        _fundInstance = IFund(fundContract);
        _setState(States.CycleOngoing);
        emit OnFundContractDeployed(fundContract, address(this));
    }

    /// @notice Called by each member to enter the term
    function depositCollateral() external payable atState(States.AcceptingCollateral) {
        require(counterMembers < totalParticipants, "Members pending");
        require(!isCollateralMember[msg.sender], "Reentry");
        require(msg.value >= fixedCollateralEth, "Eth payment too low");

        collateralMembersBank[msg.sender] += msg.value;
        isCollateralMember[msg.sender] = true;
        participants.push(msg.sender);
        counterMembers++;

        emit OnCollateralDeposited(msg.sender);

        if (counterMembers == 1) {
            firstDepositTime = block.timestamp;
        }
    }

    /// @notice Called from Fund contract when someone defaults
    /// @dev Check EnumerableMap (openzeppelin) for arrays that are being accessed from Fund contract
    /// @param beneficiary Address that was randomly selected for the current cycle
    /// @param defaulters Address that was randomly selected for the current cycle
    function requestContribution(
        address beneficiary,
        address[] calldata defaulters
    ) external atState(States.CycleOngoing) returns (address[] memory) {
        require(fundContract == msg.sender, "Wrong caller");
        require(defaulters.length > 0, "No defaulters");

        address ben = beneficiary;
        bool wasBeneficiary = false;
        address currentDefaulter;
        address currentParticipant;
        address[] memory nonBeneficiaries = new address[](participants.length);
        address[] memory expellants = new address[](defaulters.length);

        uint totalExpellants;
        uint nonBeneficiaryCounter;
        uint share;
        uint currentDefaulterBank;

        uint contributionAmountWei = _getToEthConversionRate(contributionAmount * 10 ** 18);

        // Determine who will be expelled and who will just pay the contribution
        // From their collateral.
        for (uint i; i < defaulters.length; ) {
            currentDefaulter = defaulters[i];
            wasBeneficiary = _fundInstance.isBeneficiary(currentDefaulter);
            currentDefaulterBank = collateralMembersBank[currentDefaulter];

            if (currentDefaulter == ben) continue; // Avoid expelling graced defaulter

            if (
                (wasBeneficiary && _isUnderCollaterized(currentDefaulter)) ||
                (currentDefaulterBank < contributionAmountWei)
            ) {
                isCollateralMember[currentDefaulter] = false; // Expelled!
                expellants[i] = currentDefaulter;
                share += currentDefaulterBank;
                collateralMembersBank[currentDefaulter] = 0;
                totalExpellants++;

                emit OnCollateralLiquidated(address(currentDefaulter), currentDefaulterBank);
            } else {
                // Subtract contribution from defaulter and add to beneficiary.
                collateralMembersBank[currentDefaulter] -= contributionAmountWei;
                collateralPaymentBank[ben] += contributionAmountWei;
            }
            unchecked {
                ++i;
            }
        }

        totalParticipants = totalParticipants - totalExpellants;

        // Divide and Liquidate
        uint256 participantsLength = participants.length;
        for (uint i; i < participantsLength; ) {
            currentParticipant = participants[i];
            if (
                !_fundInstance.isBeneficiary(currentParticipant) &&
                isCollateralMember[currentParticipant]
            ) {
                nonBeneficiaries[nonBeneficiaryCounter] = currentParticipant;
                nonBeneficiaryCounter++;
            }
            unchecked {
                ++i;
            }
        }

        // Finally, divide the share equally among non-beneficiaries
        if (nonBeneficiaryCounter > 0) {
            // This case can only happen when what?
            share = share / nonBeneficiaryCounter;
            for (uint i; i < nonBeneficiaryCounter; ) {
                collateralPaymentBank[nonBeneficiaries[i]] += share;
                unchecked {
                    ++i;
                }
            }
        }

        return (expellants);
    }

    /// @notice Called by each member after the end of the cycle to withraw collateral
    /// @dev This follows the pull-over-push pattern.
    function withdrawCollateral() external atState(States.ReleasingCollateral) {
        uint amount = collateralMembersBank[msg.sender] + collateralPaymentBank[msg.sender];
        require(amount > 0, "Nothing to claim");

        collateralMembersBank[msg.sender] = 0;
        collateralPaymentBank[msg.sender] = 0;
        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success);

        emit OnCollateralWithdrawn(msg.sender, amount);

        --counterMembers;
        // If last person withdraws, then change state to EOL
        if (counterMembers == 0) {
            _setState(States.Closed);
        }
    }

    function withdrawReimbursement(address participant) external {
        require(address(fundContract) == address(msg.sender), "Wrong caller");
        uint amount = collateralPaymentBank[participant];
        require(amount > 0, "Nothing to claim");
        collateralPaymentBank[participant] = 0;

        (bool success, ) = payable(participant).call{value: amount}("");
        require(success);

        emit OnReimbursementWithdrawn(participant, amount);
    }

    function releaseCollateral() external {
        require(address(fundContract) == address(msg.sender), "Wrong caller");
        _setState(States.ReleasingCollateral);
    }

    /// @notice Checks if a user has a collateral below 1.0x of total contribution amount
    /// @dev This will revert if called during ReleasingCollateral or after
    /// @param member The user to check for
    /// @return Bool check if member is below 1.0x of collateralDeposit
    function isUnderCollaterized(address member) external view returns (bool) {
        return _isUnderCollaterized(member);
    }

    /// @notice allow the owner to empty the Collateral after 180 days
    function emptyCollateralAfterEnd() external onlyOwner atState(States.ReleasingCollateral) {
        require(block.timestamp > (_fundInstance.fundEnd()) + 180 days, "Can't empty yet");
        uint256 participantsLength = participants.length;
        for (uint i; i < participantsLength; ) {
            address participant = participants[i];
            collateralMembersBank[participant] = 0;
            collateralPaymentBank[participant] = 0;
            unchecked {
                ++i;
            }
        }
        _setState(States.Closed);

        (bool success, ) = payable(msg.sender).call{value: address(this).balance}("");
        require(success);
    }

    function getCollateralSummary()
        external
        view
        returns (States, uint, uint, uint, uint, uint, uint, uint)
    {
        return (
            state, // Current state of Collateral
            cycleTime, // Cycle duration
            totalParticipants, // Total no. of participants
            collateralDeposit, // Collateral
            contributionAmount, // Required contribution per cycle
            contributionPeriod, // Time to contribute
            counterMembers, // Current member count
            fixedCollateralEth // Fixed ether to deposit
        );
    }

    function getParticipantSummary(address participant) external view returns (uint, uint, bool) {
        return (
            collateralMembersBank[participant],
            collateralPaymentBank[participant],
            isCollateralMember[participant]
        );
    }

    /// @notice Gets latest ETH / USD price
    /// @return uint latest price in Wei
    function getLatestPrice() public view returns (uint) {
        (, int price, , , ) = priceFeed.latestRoundData(); //8 decimals
        return uint(price * 10 ** 10); //18 decimals
    }

    function _setState(States newState) internal {
        States oldState = state;
        state = newState;
        emit OnStateChanged(oldState, newState);
    }

    /// @notice Gets the conversion rate of an amount in USD to ETH
    /// @dev should we always deal with in Wei?
    /// @return uint converted amount in wei
    function _getToEthConversionRate(uint USDAmount) public view returns (uint) {
        uint ethPrice = getLatestPrice();
        uint USDAmountInEth = (USDAmount * 10 ** 18) / ethPrice; //* 10 ** 18;
        return USDAmountInEth;
    }

    /// @notice Gets the conversion rate of an amount in ETH to USD
    /// @dev should we always deal with in Wei?
    /// @return uint converted amount in USD correct to 18 decimals
    function _getToUSDConversionRate(uint ethAmount) public view returns (uint) {
        // NOTE: This will be made internal
        uint ethPrice = getLatestPrice();
        uint ethAmountInUSD = (ethPrice * ethAmount) / 10 ** 18;
        return ethAmountInUSD;
    }

    /// @notice Checks if a user has a collateral below 1.0x of total contribution amount
    /// @dev This will revert if called during ReleasingCollateral or after
    /// @param member The user to check for
    /// @return Bool check if member is below 1.0x of collateralDeposit
    function _isUnderCollaterized(address member) internal view returns (bool) {
        uint collateralLimit;
        uint memberCollateralUSD;
        if (fundContract == address(0)) {
            collateralLimit = totalParticipants * contributionAmount * 10 ** 18;
        } else {
            uint remainingCycles = 1 + counterMembers - _fundInstance.currentCycle();
            collateralLimit = remainingCycles * contributionAmount * 10 ** 18; // Convert to Wei
        }

        memberCollateralUSD = _getToUSDConversionRate(collateralMembersBank[member]);

        return (memberCollateralUSD < collateralLimit);
    }
}
