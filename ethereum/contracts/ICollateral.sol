// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

/// @title Takaturn Collateral Interface
/// @author Aisha EL Allam
/// @notice This is used to allow fund to easily communicate with collateral
/// @dev v2.0 (post-deploy)
interface ICollateral {
    enum States {
        AcceptingCollateral, //Initial state where collateral are deposited
        CycleOngoing, //Triggered when a fund instance is created, no collateral can be accepted
        ReleasingCollateral, //Triggered when the fund closes
        Closed //Triggers when all participants withdraw their collaterals
    }

    /// @notice Called by each member to enter the Fund
    /// @dev needs to call the fund creation function
    function depositCollateral() external payable;

    /// @notice Called by the manager when the cons job goes off
    /// @dev consider making the duration a variable
    function initiateFundContract() external;

    /// @notice Called from Fund contract when someone defaults
    /// @dev Check EnumerableMap (openzeppelin) for arrays that are being accessed from Fund contract
    /// @param beneficiary Address that was randomly selected for the current cycle
    /// @param defaulters Address that was randomly selected for the current cycle
    function requestContribution(address beneficiary, address[] calldata defaulters) external returns (address[] memory);

    /// @notice Called by each member after the end of the cycle to withraw collateral
    /// @dev This follows the pull-over-push pattern.
    function withdrawCollateral() external;

    function withdrawReimbursement(address participant) external;

    function releaseCollateral() external;

    /// @notice Checks if a user has a collateral below 1.0x of total contribution amount
    /// @dev This will revert if called during ReleasingCollateral or after
    /// @param member The user to check for
    /// @return Bool check if member is below 1.0x of collateralDeposit
    function isUnderCollaterized(address member) external view returns (bool);

    /// @notice allow the owner to empty the Collateral after 180 days
    function emptyCollateralAfterEnd() external;

    function getCollateralSummary() external view returns (States, uint, uint, uint, uint, uint, uint, uint);

    function getParticipantSummary(address participant) external view returns (uint, uint, bool);

    function collateralPaymentBank(address participant) external view returns (uint);
}
